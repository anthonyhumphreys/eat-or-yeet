import { afterEach, expect, it, vi } from "vitest";
import { FirecrawlBatchRetry, readFirecrawlFdaBatch, startFirecrawlFdaBatch } from "@/lib/incidents/firecrawl-batch";

const id = "00000000-0000-4000-8000-000000000001";
const url = "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/fixture";
const doc = () => ({ rawBase64: btoa(`<link rel="canonical" href="${url}"><p>Original notice</p>`), rawHtml: `<link rel="canonical" href="${url}"><p>Original notice</p>`, metadata: { sourceURL: url, url, statusCode: 200 } });
afterEach(() => vi.unstubAllGlobals());

it("submits explicit FDA URLs with two browsers and no generated extraction", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true, id })); vi.stubGlobal("fetch", fetcher);
  expect(await startFirecrawlFdaBatch([url], "private-key")).toBe(id);
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body).toMatchObject({ urls: [url], maxConcurrency: 2, formats: ["rawBase64"], maxAge: 0, ignoreInvalidURLs: false });
  expect(fetcher.mock.calls[0][1].redirect).toBe("manual");
});

it("reuses the job while pending and parses completed original HTML", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "scraping", total: 1, completed: 0, data: [] })); vi.stubGlobal("fetch", fetcher);
  expect(await readFirecrawlFdaBatch(id, [url], "key", (_url, html) => html)).toBeNull();
  fetcher.mockResolvedValue(Response.json({ status: "completed", total: 1, completed: 1, data: [doc()] }));
  expect(await readFirecrawlFdaBatch(id, [url], "key", (_url, html) => html)).toEqual([doc().rawHtml]);
});

it("rejects missing, duplicated, redirected and partial documents", async () => {
  for (const data of [[], [doc(), doc()], [{ ...doc(), metadata: { ...doc().metadata, url: url + "-other" } }], [{ ...doc(), metadata: { ...doc().metadata, statusCode: 206 } }]]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "completed", total: 1, completed: 1, data })));
    await expect(readFirecrawlFdaBatch(id, [url], "key", (_url, html) => html)).rejects.toThrow();
  }
});

it("never forwards a credential to a returned pagination host", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "completed", total: 1, completed: 1, data: [], next: "https://other.example/?skip=0" })); vi.stubGlobal("fetch", fetcher);
  await expect(readFirecrawlFdaBatch(id, [url], "key", (_url, html) => html)).rejects.toThrow("continuation");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("reads paginated documents in source order even when the vendor returns a different order", async () => {
  const second = url + "-second";
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ status: "completed", total: 2, completed: 2, data: [{ rawBase64: btoa(`<link rel="canonical" href="${second}"><p>Second</p>`), metadata: { sourceURL: second, url: second, statusCode: 200 } }], next: `https://api.firecrawl.dev/v2/batch/scrape/${id}?skip=1` }))
    .mockResolvedValueOnce(Response.json({ status: "completed", total: 2, completed: 2, data: [doc()] }));
  vi.stubGlobal("fetch", fetcher);
  expect(await readFirecrawlFdaBatch(id, [url, second], "key", source => source)).toEqual([url, second]);
  expect(fetcher.mock.calls[1][0]).toBe(`https://api.firecrawl.dev/v2/batch/scrape/${id}?skip=1`);
});

it("reschedules a rejected rate-limited submission without retrying it in place", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("private-key", { status: 429, headers: { "retry-after": "30" } })); vi.stubGlobal("fetch", fetcher);
  await expect(startFirecrawlFdaBatch([url], "private-key")).rejects.toBeInstanceOf(FirecrawlBatchRetry);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
