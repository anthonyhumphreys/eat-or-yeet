import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const {query,entries} = vi.hoisted(()=>({query:vi.fn(),entries:new Map<string,Promise<unknown>>()}));
vi.mock("@backend/client",()=>({fetchQuery:query}));
vi.mock("next/cache",()=>({unstable_cache:(fn:(...args:unknown[])=>Promise<unknown>,keys:string[])=>(...args:unknown[])=>{
  const key=JSON.stringify([keys,args]);if(!entries.has(key)){const promise=fn(...args);entries.set(key,promise);void promise.catch(()=>entries.delete(key));}return entries.get(key);
}}));
const now=Date.parse("2026-10-27T12:00:00Z");
let revision:string;
let boundaryAt:number|null;
let calls:number;
beforeEach(()=>{
  vi.resetModules();vi.clearAllMocks();entries.clear();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);vi.stubEnv("BACKEND_URL","https://fixture.workers.dev");
  revision="revision-1";boundaryAt=null;calls=0;
  query.mockImplementation(async(ref,args)=>{
    if(ref.name==="incidents.getDatasetVersion")return revision;
    calls++;
    return {filters:args.filters,rows:[],total:0,revision,asOf:Date.now(),boundaryAt,nextCursor:null,top:null,facets:{hazards:[],types:[],categories:[],stores:[],tabs:[],categoryTabs:[],typeTotal:0}};
  });
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});

describe("indexed browse cache and route",()=>{
  it("keys cached pages by region, filters, cursor and revision",async()=>{
    const {getBrowsePage}=await import("@/db/browse");
    await getBrowsePage("UK",{q:"milk"});await getBrowsePage("UK",{q:"milk"});expect(calls).toBe(1);
    await getBrowsePage("US",{q:"milk"});await getBrowsePage("UK",{q:"egg"});await getBrowsePage("UK",{q:"milk"},"next");expect(calls).toBe(4);
    revision="revision-2";await getBrowsePage("UK",{q:"milk"});expect(calls).toBe(5);
  });
  it("bypasses a warm cached page at an eligibility boundary",async()=>{
    boundaryAt=now+1000;
    const {getBrowsePage}=await import("@/db/browse");
    await getBrowsePage("UK",{q:""});vi.setSystemTime(now+1000);await getBrowsePage("UK",{q:""});expect(calls).toBe(2);
  });
  it("returns controlled restart and unavailable responses, and rejects invalid regions",async()=>{
    const {BackendError}=await import("@backend/values");
    const {GET}=await import("@/app/api/warnings/route");
    query.mockImplementation(async ref=>{if(ref.name==="incidents.getDatasetVersion")return revision;throw new BackendError({code:"BROWSE_RESTART"});});
    expect((await GET(new Request("https://fixture.test/api/warnings?region=UK"))).status).toBe(409);
    query.mockRejectedValue(new Error("Offline"));
    expect((await GET(new Request("https://fixture.test/api/warnings?region=UK"))).status).toBe(503);
    expect((await GET(new Request("https://fixture.test/api/warnings?region=invalid"))).status).toBe(400);
  });
});
