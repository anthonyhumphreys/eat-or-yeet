import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_SOURCE_TEXT_BYTES } from "@/lib/http/bounded-response";
import { createFdaAnnouncementsSource, parseFdaAnnouncementDetail, parseFdaAnnouncementRows } from "@/lib/incidents/fda-announcements";
import { fetchFirecrawlFdaHtml } from "@/lib/incidents/firecrawl";

const path = "/safety/recalls-market-withdrawals-safety-alerts/fixture-recall";
const url = `https://www.fda.gov${path}`;
const key = "fc-private-test-key";
const html = '<h2 id="recall-announcement">Company Announcement</h2><p>Fixture recall, lot 123. Consumers should return this product.</p><h2>Contact</h2>';
const row = ['<time datetime="2026-10-01">October 1</time>', `<a href="${path}">Fixture brand</a>`, "Fixture product", "Food &amp; Beverages", "Undeclared milk", "Fixture company", "", ""];
const validPayload = () => ({ success: true, data: { rawHtml: html, metadata: { statusCode: 200, sourceURL: url, url } } });

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Firecrawl FDA page retrieval", () => {
  it("requests fresh raw HTML from a fixed endpoint without sending user data or using AI extraction", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json(validPayload()));
    await expect(fetchFirecrawlFdaHtml(url, key)).resolves.toBe(html);
    const [endpoint, init] = vi.mocked(fetch).mock.calls[0];
    expect(endpoint).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(init).toMatchObject({ method: "POST", headers: { Authorization: `Bearer ${key}` }, redirect: "manual", cache: "no-store" });
    expect(JSON.parse(init!.body as string)).toEqual({ url, formats: ["rawHtml"], onlyMainContent: false, maxAge: 0, timeout: 30_000, location: { country: "US", languages: ["en-US"] } });
  });

  it.each([
    "https://example.com/recall", "http://www.fda.gov" + path,
    "https://www.fda.gov/datatable/api", url + "?secret=value", url + "#fragment",
    "https://user:password@www.fda.gov" + path,
  ])("rejects non-canonical or unsupported source URL %s before making a request", async value => {
    await expect(fetchFirecrawlFdaHtml(value, key)).rejects.toThrow("canonical FDA");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires a key before making a paid request", async () => {
    await expect(fetchFirecrawlFdaHtml(url, " ")).rejects.toThrow("FIRECRAWL_API_KEY");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([206, 302, 401, 402, 429, 503])("rejects HTTP %s without following redirects, retrying paid requests or exposing the response", async status => {
    vi.mocked(fetch).mockResolvedValue(new Response(key, { status }));
    await expect(fetchFirecrawlFdaHtml(url, key)).rejects.toThrow(`HTTP ${status}`);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("sanitises transport failures", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error(`request failed with ${key}`));
    await expect(fetchFirecrawlFdaHtml(url, key)).rejects.toThrow(/^Firecrawl FDA detail request failed; check connectivity and credentials$/);
  });

  it.each([
    { success: false, error: key },
    { success: true, data: {} },
    { ...validPayload(), warning: "Incomplete scrape" },
    { success: true, data: { ...validPayload().data, rawHtml: "" } },
    { success: true, data: { ...validPayload().data, warning: "Partial response" } },
    { success: true, data: { ...validPayload().data, metadata: { statusCode: 403, sourceURL: url } } },
    { success: true, data: { ...validPayload().data, metadata: { statusCode: 206, sourceURL: url, url } } },
    { success: true, data: { ...validPayload().data, metadata: { statusCode: 200, sourceURL: url } } },
    { success: true, data: { ...validPayload().data, metadata: { statusCode: 200, sourceURL: url + "-other" } } },
    { success: true, data: { ...validPayload().data, metadata: { statusCode: 200, sourceURL: url, url: "https://example.com/recall" } } },
    { success: true, data: { ...validPayload().data, metadata: { statusCode: 200, sourceURL: url, error: key } } },
  ])("rejects incomplete, blocked or mismatched scrape responses", async payload => {
    vi.mocked(fetch).mockResolvedValue(Response.json(payload));
    await expect(fetchFirecrawlFdaHtml(url, key)).rejects.toThrow(/^Firecrawl returned an invalid, incomplete or oversized FDA detail response$/);
  });

  it("requires a matching page canonical URL when the vendor omits its final URL", async () => {
    const payload = { success: true, data: { rawHtml: `<link href='${url}' rel='canonical'>${html}`, metadata: { statusCode: 200, sourceURL: url } } };
    vi.mocked(fetch).mockResolvedValue(Response.json(payload));
    await expect(fetchFirecrawlFdaHtml(url, key)).resolves.toBe(payload.data.rawHtml);
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...payload, data: { ...payload.data, rawHtml: `<link rel="canonical" href="${url}-wrong">${html}` } }));
    await expect(fetchFirecrawlFdaHtml(url, key)).rejects.toThrow("invalid");
  });

  it("rejects oversized response bodies before parsing", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { headers: { "Content-Length": String(4 * MAX_SOURCE_TEXT_BYTES + 1) } }));
    await expect(fetchFirecrawlFdaHtml(url, key)).rejects.toThrow("oversized");
  });

  it("counts source HTML bytes rather than only characters", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...validPayload(), data: { ...validPayload().data, rawHtml: "é".repeat(MAX_SOURCE_TEXT_BYTES / 2 + 1) } }));
    await expect(fetchFirecrawlFdaHtml(url, key)).rejects.toThrow("oversized");
  });
});

describe("FDA import with optional Firecrawl detail retrieval", () => {
  function mockSource(detailResponse = validPayload()) {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const address = String(input);
      if (address === "https://api.firecrawl.dev/v2/scrape") return Response.json(detailResponse);
      if (address.includes("/datatables/views/ajax")) {
        const draw = Number(new URL(address).searchParams.get("draw"));
        return Response.json({ draw, recordsFiltered: 1, recordsTotal: 1, data: [row] });
      }
      if (address === url) return new Response(html);
      return new Response('<script type="application/json" data-drupal-selector="drupal-settings-json">{"datatables":{"recalls":{"ajax":{"data":{"view_name":"recall_solr_index"}}}}}</script>');
    });
  }

  it("uses the complete FDA listings and the existing parser, keeping Firecrawl credentials off FDA requests", async () => {
    mockSource();
    const source = createFdaAnnouncementsSource({ mode: "firecrawl", apiKey: key });
    const incidents = await source.fetchIncidents();
    expect(incidents).toEqual([parseFdaAnnouncementDetail(parseFdaAnnouncementRows({ data: [row] })[0], html)]);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.filter(([address]) => String(address).includes("/datatables/views/ajax"))).toHaveLength(2);
    expect(calls.filter(([address]) => address === "https://api.firecrawl.dev/v2/scrape")).toHaveLength(1);
    expect(calls.filter(([address]) => String(address).startsWith("https://www.fda.gov")).every(([, init]) => !new Headers(init?.headers).has("Authorization"))).toBe(true);
  });

  it("keeps direct retrieval as the default even when a Firecrawl key is configured", async () => {
    mockSource();
    vi.stubEnv("FIRECRAWL_API_KEY", key);
    vi.stubEnv("FDA_ANNOUNCEMENTS_FETCH_MODE", "firecrawl");
    await createFdaAnnouncementsSource().fetchIncidents();
    expect(vi.mocked(fetch).mock.calls.some(([address]) => address === url)).toBe(true);
    expect(vi.mocked(fetch).mock.calls.some(([address]) => String(address).includes("firecrawl"))).toBe(false);
  });

  it("fails missing Firecrawl credentials before reading the source", async () => {
    await expect(createFdaAnnouncementsSource({ mode: "firecrawl" }).fetchIncidents()).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails the complete refresh when Firecrawl returns an error page as HTTP 200", async () => {
    mockSource({ ...validPayload(), data: { ...validPayload().data, rawHtml: "<h1>Access denied</h1>" } });
    await expect(createFdaAnnouncementsSource({ mode: "firecrawl", apiKey: key }).fetchIncidents()).rejects.toThrow("detail import failed");
    expect(vi.mocked(fetch).mock.calls.some(([address]) => address === url)).toBe(false);
  });

  it("rejects a partial FDA listing before scraping any details", async () => {
    mockSource();
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (address, init) => String(address).includes("/datatables/views/ajax")
      ? Response.json({ draw: Number(new URL(String(address)).searchParams.get("draw")), recordsFiltered: 2, recordsTotal: 2, data: [row] })
      : original(address, init));
    await expect(createFdaAnnouncementsSource({ mode: "firecrawl", apiKey: key }).fetchIncidents()).rejects.toThrow("incomplete");
    expect(vi.mocked(fetch).mock.calls.some(([address]) => String(address).includes("firecrawl"))).toBe(false);
  });
});
