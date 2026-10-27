import { Buffer } from "node:buffer";
import { z } from "zod";
import { query, internalMutation, internalAction } from "./operations";
import { BackendError } from "./values";
import { internal } from "./api";
import { datasetVersion, bumpDatasetVersions } from "./lib/dataset_version";
import { browseContent, browseRowSchema } from "./lib/browse_projection";
import { productCategories, superCategories } from "../src/lib/incidents/browse";
import { hazardKinds } from "../src/lib/incidents/hazard";
import { warningSearchTerms } from "../src/lib/incidents/warning-search";

const PAGE_SIZE = 40;
const filtersSchema = z.object({ q: z.string().max(120), hazard: z.enum(hazardKinds).optional(), type: z.enum(superCategories).optional(), category: z.enum(productCategories).optional(), store: z.string().max(120).optional() });
const cursorSchema = z.strictObject({ v: z.literal(1), revision: z.string(), scope: z.string(), asOf: z.number().int().nonnegative(), offset: z.number().int().min(0).max(40000) });
const restart = () => new BackendError({ code: "BROWSE_RESTART", message: "The recall list changed. Restart browsing to see current results." });

export const list = query({
  args: { region: z.enum(["UK", "US"]), filters: filtersSchema, cursor: z.string().max(4096).optional(), expectedVersion: z.string().max(300).optional() },
  handler: async (ctx, { region, filters, cursor, expectedVersion }) => {
    const sql = ctx.db.sql;
    if (await sql.prepare("SELECT 1 FROM warning_browse_dirty WHERE region=? LIMIT 1").bind(region).first()) throw new BackendError({ code: "BROWSE_INDEX_NOT_READY" });
    const revision = await datasetVersion(ctx, region);
    if (expectedVersion !== undefined && revision !== expectedVersion) throw restart();
    const terms = warningSearchTerms(filters.q);
    const scope = JSON.stringify({ region, ...filters, q: terms.join(" ") });
    let offset = 0;
    let asOf = Date.now();
    if (cursor) {
      let parsed: z.infer<typeof cursorSchema>;
      try { parsed = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))); } catch { throw restart(); }
      if (parsed.revision !== revision || parsed.scope !== scope || parsed.asOf > Date.now() || Date.now() >= parsed.asOf + 600000) throw restart();
      ({ offset, asOf } = parsed);
    }
    const where = (skip: string[] = [], search = true) => {
      const clauses = ["b.region=?", "b.status IN ('active','reported')", "b.is_demo=0", "b.starts_at<=?", "(b.ends_at IS NULL OR b.ends_at>?)"];
      const params: (string | number)[] = [region, asOf, asOf];
      if (search && terms.length) {
        clauses.push(`b.rowid IN (SELECT rowid FROM warning_search WHERE ${terms.map(() => "search_text LIKE ?").join(" AND ")})`);
        params.push(...terms.map(term => `%${term}%`));
      }
      if (!skip.includes("hazard") && filters.hazard) { clauses.push("b.hazard_kind=?"); params.push(filters.hazard); }
      for (const [facet, value] of [["type", filters.type], ["category", filters.category], ["store", filters.store]] as const) {
        if (value && !skip.includes(facet)) { clauses.push("EXISTS(SELECT 1 FROM warning_browse_facets f WHERE f.browse_id=b.id AND f.facet=? AND f.value=?)"); params.push(facet, value); }
      }
      return { clause: clauses.join(" AND "), params };
    };
    const select = (columns: string, skip: string[] = [], tail = "", search = true) => {
      const { clause, params } = where(skip, search);
      return sql.prepare(`SELECT ${columns} FROM warning_browse b WHERE ${clause} ${tail}`).bind(...params);
    };
    const facet = (name: string, skip: string[], search = true) => {
      const { clause, params } = where(skip, search);
      return sql.prepare(`SELECT f.value AS key,COUNT(*) AS count FROM warning_browse b JOIN warning_browse_facets f ON f.browse_id=b.id AND f.facet=? WHERE ${clause} GROUP BY f.value ORDER BY f.value`).bind(name,...params);
    };
    const boundary = sql.prepare(`SELECT MIN(boundary) AS boundary FROM (
      SELECT MIN(starts_at) AS boundary FROM warning_browse WHERE region=? AND status IN ('active','reported') AND is_demo=0 AND starts_at>?
      UNION ALL SELECT MIN(ends_at) FROM warning_browse WHERE region=? AND status IN ('active','reported') AND is_demo=0 AND ends_at>?)`).bind(region,asOf,region,asOf);
    const { clause, params } = where();
    const topWhere = where(["hazard","type","category","store"], false);
    const top = sql.prepare(`SELECT b.data FROM warning_browse b WHERE ${topWhere.clause} AND b.status='active' AND EXISTS(SELECT 1 FROM warning_browse_facets f WHERE f.browse_id=b.id AND f.facet='type' AND f.value='Food') ORDER BY CASE WHEN b.hazard_kind='pathogen' AND b.updated_at>=? THEN 0 ELSE 1 END,b.updated_at DESC,b.id ASC LIMIT 1`).bind(...topWhere.params,asOf-30*86400000);
    const result = await sql.batch<Record<string, unknown>>([
      boundary,
      sql.prepare(`SELECT b.data FROM warning_browse b WHERE ${clause} ORDER BY b.updated_at DESC,b.id ASC LIMIT ? OFFSET ?`).bind(...params,PAGE_SIZE+1,offset),
      select("COUNT(*) AS count"),
      select("b.hazard_kind AS key,COUNT(*) AS count",["hazard"],"GROUP BY b.hazard_kind"),
      facet("type",["type","category"]), facet("category",["category"]), facet("store",["store"]),
      facet("type",["hazard","type","category","store"],false),
      facet("category",["hazard","category","store"],false), top, select("COUNT(*) AS count",["type","category"]),
    ]);
    const boundaryAt = z.number().nullable().parse(result[0].results[0]?.boundary ?? null);
    if (boundaryAt !== null && Date.now() >= boundaryAt) throw restart();
    const readRows = (index: number) => result[index].results.map(row => browseRowSchema.parse(JSON.parse(z.string().parse(row.data))));
    const pairs = (index: number) => result[index].results.map(row => z.object({ key: z.string(), count: z.number() }).parse(row));
    const rows = readRows(1);
    return {
      rows: rows.slice(0,PAGE_SIZE), total: z.number().parse(result[2].results[0].count),
      filters, revision, asOf, boundaryAt,
      nextCursor: rows.length > PAGE_SIZE ? Buffer.from(JSON.stringify({ v:1,revision,scope,asOf,offset:offset+PAGE_SIZE })).toString("base64url") : null,
      facets: { typeTotal: z.number().parse(result[10].results[0].count), hazards: pairs(3), types: pairs(4), categories: pairs(5), stores: pairs(6).map(row => row.key), tabs: pairs(7).map(row => row.key), categoryTabs: pairs(8).map(row => row.key) },
      top: readRows(9)[0] ?? null,
    };
  },
});

export const rebuildBatch = internalMutation({
  args: { cursor: z.string().nullable() },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("incidentMatchData").paginate({ numItems:25,cursor });
    await ctx.db.preloadIds(page.page.map(row => row.incidentId));
    for (const row of page.page) {
      const source = await ctx.db.get("incidents",row.incidentId);
      await ctx.db.patch(row._id,browseContent(row,source?.originalSourceData));
    }
    await bumpDatasetVersions(ctx,new Set(page.page.map(row => row.region)));
    return { cursor:page.continueCursor,isDone:page.isDone,count:page.page.length };
  },
});

export const rebuild = internalAction({
  args: {},
  handler: async ctx => {
    let cursor: string | null = null;
    let count = 0;
    while (true) {
      const page: {cursor:string;isDone:boolean;count:number} = await ctx.runMutation(internal.browse.rebuildBatch,{cursor});
      count += page.count;
      if (page.isDone) return {count};
      cursor = page.cursor;
    }
  },
});
