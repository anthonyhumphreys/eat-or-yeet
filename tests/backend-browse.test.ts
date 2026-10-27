import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "@backend/api";
import type { Id } from "@backend/values";
import { revision } from "@backend/database";
import { createBackend } from "./backend-harness";

const now = Date.parse("2026-10-27T12:00:00Z");
async function fixture(count=130) {
  const backend = createBackend();
  await backend.run(async ctx => {
    for (let index=0;index<count;index++) await ctx.db.insert("incidentMatchData", {
      incidentId:`incidents:fixture-${index}` as Id<"incidents">,slug:`fixture-${index}`,title:`Fixture product ${index}`,
      region:"UK",status:"active",isDemo:false,startsAt:1,publishedAt:1,updatedAt:now-index,
      hazard:"Undeclared milk, egg and sesame allergens",summary:"Check the pack",consumerAdvice:"Return it",
      authority:"Food Standards Agency",authorityUrl:"https://alerts.food.gov.uk/",sourceId:`FSA-${index}`,severity:"high",confidence:1,
      categories:index%2 ? ["Snacks & sweets"] : ["Dairy & eggs"],superCategories:["Food"],stores:index%2 ? ["Tesco"] : ["Waitrose"],
      targets:[{type:"brand",value:"Northstar",valueNormalized:"northstar",matchType:"exact",weight:25,confidence:1}],
    });
  });
  return backend;
}
afterEach(() => vi.useRealTimers());

describe("indexed public browsing", () => {
  it("rolls back index and facet changes when the transaction fence fails", async () => {
    const backend = await fixture(2);
    await expect(backend.run(async ctx => {
      const before = await revision(ctx.db.sql);
      const row = (await ctx.db.query("incidentMatchData").first())!;
      await ctx.db.patch(row._id,{title:"Must not be committed",stores:["Rollback shop"]});
      await ctx.db.commit(before-1);
    })).rejects.toThrow();
    expect((await backend.query(api.browse.list,{region:"UK",filters:{q:"must not"}})).total).toBe(0);
    expect((await backend.query(api.browse.list,{region:"UK",filters:{q:""}})).facets.stores).not.toContain("Rollback shop");
  });

  it("returns bounded ordered pages, complete counts and facets, and full search fields", async () => {
    const backend=await fixture();
    const filters={q:"sesame northstar"};
    const first=await backend.query(api.browse.list,{region:"UK",filters});
    expect(first.rows).toHaveLength(40);
    expect(first.total).toBe(130);
    expect(first.rows[0].slug).toBe("fixture-0");
    expect(first.facets.hazards).toEqual([{key:"allergen",count:130}]);
    expect(first.facets.stores).toEqual(["Tesco","Waitrose"]);
    expect(first.facets.categories).toEqual([{key:"Dairy & eggs",count:65},{key:"Snacks & sweets",count:65}]);
    let page=first;
    const slugs=page.rows.map(row=>row.slug);
    while(page.nextCursor) { page=await backend.query(api.browse.list,{region:"UK",filters,cursor:page.nextCursor});slugs.push(...page.rows.map(row=>row.slug)); }
    expect(slugs).toEqual(Array.from({length:130},(_,i)=>`fixture-${i}`));
    const filtered=await backend.query(api.browse.list,{region:"UK",filters:{q:"sesame",hazard:"allergen",category:"Dairy & eggs",store:"Waitrose"}});
    expect(filtered.total).toBe(65);
    expect((await backend.query(api.browse.list,{region:"UK",filters:{q:"sesame nonexistent"}})).total).toBe(0);
    expect((await backend.query(api.browse.list,{region:"UK",filters:{q:"mi"}})).total).toBe(130);
  });

  it("rejects changed filters, revision, expiry and eligibility boundaries", async () => {
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);
    const backend=await fixture();
    const first=await backend.query(api.browse.list,{region:"UK",filters:{q:""}});
    await expect(backend.query(api.browse.list,{region:"UK",filters:{q:"changed"},cursor:first.nextCursor!})).rejects.toThrow("BROWSE_RESTART");
    vi.setSystemTime(now+600000);
    await expect(backend.query(api.browse.list,{region:"UK",filters:{q:""},cursor:first.nextCursor!})).rejects.toThrow("BROWSE_RESTART");
    vi.setSystemTime(now);
    await backend.run(async ctx => { const row=(await ctx.db.query("incidentMatchData").first())!;await ctx.db.patch(row._id,{endsAt:now+1000}); });
    const bounded=await backend.query(api.browse.list,{region:"UK",filters:{q:""}});
    vi.setSystemTime(now+1000);
    await expect(backend.query(api.browse.list,{region:"UK",filters:{q:""},cursor:bounded.nextCursor!})).rejects.toThrow("BROWSE_RESTART");
    vi.setSystemTime(now);
    await backend.run(ctx=>ctx.db.insert("datasetVersions",{region:"UK",revision:1}));
    await expect(backend.query(api.browse.list,{region:"UK",filters:{q:""},cursor:first.nextCursor!})).rejects.toThrow("BROWSE_RESTART");
  });

  it("maintains the index atomically on changes/deletion and rejects stale indexes from older writers", async () => {
    const backend=await fixture(2);
    await backend.run(async ctx => {
      const row=(await ctx.db.query("incidentMatchData").first())!;
      await ctx.db.patch(row._id,{status:"resolved"});
    });
    expect((await backend.query(api.browse.list,{region:"UK",filters:{q:""}})).total).toBe(1);
    await backend.run(async ctx => {
      const row=(await ctx.db.query("incidentMatchData").withIndex("by_region_status",q=>q.eq("region","UK").eq("status","active")).first())!;
      await ctx.db.sql.prepare("UPDATE records SET payload=json_set(payload,'$.title','Old writer change') WHERE id=?").bind(row._id).run();
    });
    await expect(backend.query(api.browse.list,{region:"UK",filters:{q:""}})).rejects.toThrow("BROWSE_INDEX_NOT_READY");
    await backend.action(internal.browse.rebuild,{});
    expect((await backend.query(api.browse.list,{region:"UK",filters:{q:"old writer"}})).total).toBe(1);
    await backend.run(async ctx => {for(const row of await ctx.db.query("incidentMatchData").collect())await ctx.db.delete(row._id);});
    expect((await backend.query(api.browse.list,{region:"UK",filters:{q:""}})).total).toBe(0);
  });

  it("keeps reported medicines browseable, excludes demos/resolved/future rows and selects a food-only top alert", async () => {
    const backend=await fixture(3);
    await backend.run(async ctx => {
      const rows=await ctx.db.query("incidentMatchData").collect();
      await ctx.db.patch(rows[0]._id,{status:"reported",superCategories:["Medical"],categories:["Over-the-counter medicines"],updatedAt:now+1});
      await ctx.db.patch(rows[1]._id,{isDemo:true});
      await ctx.db.patch(rows[2]._id,{hazard:"Listeria contamination",pathogen:"Listeria"});
    });
    const page=await backend.query(api.browse.list,{region:"UK",filters:{q:""}});
    expect(page.total).toBe(2);
    expect(page.top?.superCategories).toEqual(["Food"]);
    expect(page.facets.tabs).toEqual(["Food","Medical"]);
    expect((await backend.query(api.browse.list,{region:"UK",filters:{q:"",type:"Medical"}})).total).toBe(1);
    expect((await backend.query(api.browse.list,{region:"US",filters:{q:""}})).total).toBe(0);
  });

  it("reduces initial response size and uses the regional and trigram indexes", async () => {
    const backend=await fixture(1600);
    const first=await backend.query(api.browse.list,{region:"UK",filters:{q:"fixture"}});
    let cursor:string|null=null;const oldRows=[];
    do {const page: {page:unknown[];isDone:boolean;continueCursor:string}=await backend.query(api.incidents.listActivePage,{region:"UK",cursor});oldRows.push(...page.page);cursor=page.isDone?null:page.continueCursor;}while(cursor);
    const before=Buffer.byteLength(JSON.stringify(oldRows)),after=Buffer.byteLength(JSON.stringify(first));
    expect(after).toBeLessThan(before/10);
    await backend.run(async ctx => {
      const plan=await ctx.db.sql.prepare("EXPLAIN QUERY PLAN SELECT id FROM warning_browse WHERE region='UK' AND status='active' AND is_demo=0 ORDER BY updated_at DESC,id ASC LIMIT 40").all();
      expect(JSON.stringify(plan.results)).toContain("warning_browse_region_order");
      const search=await ctx.db.sql.prepare("EXPLAIN QUERY PLAN SELECT rowid FROM warning_search WHERE search_text LIKE '%fixture%'").all();
      expect(JSON.stringify(search.results)).toContain("VIRTUAL TABLE INDEX");
    });
    console.log(JSON.stringify({browseBenchmark:{rows:1600,beforeBytes:before,afterBytes:after,backendPageRequests:1}}));
  });
});
