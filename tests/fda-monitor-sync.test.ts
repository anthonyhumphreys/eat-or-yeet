import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pollFdaMonitor } from "../scripts/lib/fda-monitor-sync";
import { fetchFdaAnnouncementListings } from "../src/lib/incidents/fda-announcements";
import { monitorRequest, monitorTargets, verifyMonitorSignature } from "../src/lib/incidents/firecrawl-monitor";
import { createHmac } from "node:crypto";

vi.mock("../src/lib/incidents/fda-announcements", async original => ({ ...await original<typeof import("../src/lib/incidents/fda-announcements")>(), fetchFdaAnnouncementListings: vi.fn() }));
const env = { NODE_ENV: "test" as const, BACKEND_URL: "https://backend.test", FDA_UPLOAD_TOKEN: "private-upload-fixture", FDA_MONITOR_ENABLED: "true", FDA_ANNOUNCEMENTS_UPLOAD_MODE: "listings" };
const listing = { path: "/safety/recalls-market-withdrawals-safety-alerts/fixture", publishedAt: new Date("2026-10-01"),
  brand: "Fixture", product: "Fixture food", productType: "Food & Beverages", reason: "Milk", company: "Fixture", terminated: false, terminationStatus: "" };
beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); vi.mocked(fetchFdaAnnouncementListings).mockResolvedValue([listing]); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

it("only polls in explicitly enabled listing mode", async () => {
  await pollFdaMonitor({ ...env, FDA_MONITOR_ENABLED: "false" });
  await pollFdaMonitor({ ...env, FDA_ANNOUNCEMENTS_UPLOAD_MODE: "full" });
  expect(fetch).not.toHaveBeenCalled();
});
it("sends fresh validated listings for the captured request version without Firecrawl access", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ result: { enabled: true, requestedVersion: 7, fulfilledVersion: 6 } }))
    .mockResolvedValueOnce(Response.json({ result: { accepted: true } }));
  await pollFdaMonitor(env);
  expect(fetchFdaAnnouncementListings).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [url, init] of vi.mocked(fetch).mock.calls) {
    expect(String(url)).toBe("https://backend.test/admin/fda-monitor");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${env.FDA_UPLOAD_TOKEN}` });
  }
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({ version: 7, payload: [{ ...listing, publishedAt: listing.publishedAt.getTime() }] });
});
it("does not retrieve listings when no refresh is requested", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ result: { enabled: true, requestedVersion: 7, fulfilledVersion: 7 } }));
  await pollFdaMonitor(env);
  expect(fetchFdaAnnouncementListings).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("rejects repeated notice paths and non-HTTPS backends before uploading", async () => {
  await expect(pollFdaMonitor({ ...env, BACKEND_URL: "http://other.test" })).rejects.toThrow("HTTPS");
  expect(fetch).not.toHaveBeenCalled();
  vi.mocked(fetch).mockResolvedValue(Response.json({ result: { enabled: true, requestedVersion: 1, fulfilledVersion: 0 } }));
  vi.mocked(fetchFdaAnnouncementListings).mockResolvedValue([listing, listing]);
  await expect(pollFdaMonitor(env)).rejects.toThrow("repeats");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("requires the signature of the exact raw body", async () => {
  const body = '{ "test": "café" }\n';
  const secret = "private-hmac-fixture";
  const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  expect(await verifyMonitorSignature(body, signature, secret)).toBe(true);
  expect(await verifyMonitorSignature(body.trim(), signature, secret)).toBe(false);
  expect(await verifyMonitorSignature(body, signature, "wrong")).toBe(false);
  expect(await verifyMonitorSignature(body, null, secret)).toBe(false);
});
it("limits detail coverage explicitly and refuses off-domain targets", () => {
  const urls = [1, 2, 3].map(x => `https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/fixture-${x}`);
  expect(monitorTargets(urls, 2)).toHaveLength(3);
  expect(monitorTargets(urls, 0)).toHaveLength(1);
  expect(() => monitorTargets(["https://other.test"], 2)).toThrow("Unexpected FDA");
  expect(() => monitorTargets(urls, 1.5)).toThrow();
});
it("does not leak vendor bodies or retry uncertain management calls", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response("private credential echoed by vendor", { status: 500 }));
  await expect(monitorRequest("/monitor", "private-api-key", "POST", {})).rejects.toThrow("HTTP 500");
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.mocked(fetch).mockResolvedValue(new Response("private", { status: 429, headers: { "retry-after": "42" } }));
  await expect(monitorRequest("/monitor", "private-api-key")).rejects.toMatchObject({ delay: 42_000 });
});
