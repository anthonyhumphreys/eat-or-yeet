import { after } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: vi.fn() }));
vi.mock("@/lib/security/anonymous", () => ({ trustedNetworkSubject: vi.fn(() => "network:test") }));
vi.mock("@/lib/security/rate-limit", () => ({ takeRateLimits: vi.fn(async () => [{ allowed: true }]) }));
import { AppCaptureSchema, analyticsPage, WebsiteCaptureSchema } from "@/lib/analytics/contracts";
import { analyticsEnabled, captureEvent, recordMcpOperation } from "@/lib/analytics/server";
import { POST } from "@/app/api/analytics/route";
import { takeRateLimits } from "@/lib/security/rate-limit";

const request = (data: unknown, consent = true, headers: Record<string, string> = {}) => new NextRequest("https://www.eatoryeet.app/api/analytics", {
  method: "POST", headers: { origin: "https://www.eatoryeet.app", "content-type": "application/json", ...(consent ? { cookie: "eat-or-yeet-analytics=v1.accepted" } : {}), ...headers }, body: JSON.stringify(data),
});

describe("analytics privacy boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.clearAllMocks();
    vi.stubEnv("POSTHOG_ENABLED", "true"); vi.stubEnv("POSTHOG_HOST", "https://eu.i.posthog.com"); vi.stubEnv("POSTHOG_PROJECT_TOKEN", "fixture"); vi.stubEnv("VERCEL_ENV", "production");
  });
  it("rejects product text, identity fields and arbitrary event names", () => {
    expect(WebsiteCaptureSchema.safeParse({ data: { event: "website_page_viewed", page: "search", barcode: "private" } }).success).toBe(false);
    expect(WebsiteCaptureSchema.safeParse({ sessionId: "private-user", data: { event: "website_page_viewed", page: "home" } }).success).toBe(false);
    expect(AppCaptureSchema.safeParse({ consent: true, host: "chatgpt", event: "app_opened", email: "person@example.test" }).success).toBe(false);
    expect(AppCaptureSchema.safeParse({ consent: false, host: "chatgpt", event: "app_opened" }).success).toBe(false);
    expect(WebsiteCaptureSchema.safeParse({ data: { event: "website_check_finished", method: "details", region: "UK", outcome: "MAYBE_YEET" } }).success).toBe(true);
    expect(analyticsPage("/incidents/private-warning-slug")).toBe("warning");
    expect(analyticsPage("/s/private-share-token")).toBe("shared_result");
    expect(analyticsPage("/unknown-private-path")).toBe("other");
  });
  it.each<Record<string, string>>([{ cookie: "eat-or-yeet-analytics=v1.declined" }, { cookie: "eat-or-yeet-analytics=v0.accepted" }, { "sec-gpc": "1" }, { dnt: "1" }])("does not schedule tracking for missing or rejected consent and privacy signals %j", async (headers) => {
    const data = { data: { event: "website_page_viewed", page: "home" } };
    expect((await POST(request(data, false))).status).toBe(204);
    expect((await POST(request(data, true, headers))).status).toBe(204);
    expect(after).not.toHaveBeenCalled(); expect(takeRateLimits).not.toHaveBeenCalled();
  });
  it("checks origin, body size, exact schema and a separate budget before scheduling", async () => {
    const valid = { data: { event: "website_page_viewed", page: "home" } };
    expect((await POST(request(valid, true, { origin: "https://attacker.test" }))).status).toBe(403);
    expect((await POST(request({ data: { event: "website_page_viewed", page: "home", query: "private" } }))).status).toBe(400);
    expect((await POST(request({ data: "x".repeat(1024) }))).status).toBe(413);
    expect(after).not.toHaveBeenCalled();
    expect((await POST(request(valid))).status).toBe(204);
    expect(takeRateLimits).toHaveBeenCalledWith([{ subject: "network:test", scope: "network" }], "analytics");
    expect(after).toHaveBeenCalledOnce();
  });
  it("fails closed on analytics quota failure", async () => {
    vi.mocked(takeRateLimits).mockRejectedValueOnce(new Error("private datastore response"));
    expect((await POST(request({ data: { event: "website_page_viewed", page: "home" } }))).status).toBe(204);
    expect(after).not.toHaveBeenCalled();
  });
  it("sends only constructed properties with fresh event IDs, no IP forwarding or profiles", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    await captureEvent("website_page_viewed", { source: "website", page: "search" });
    await captureEvent("website_page_viewed", { source: "website", page: "search" });
    const payloads = fetcher.mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
    expect(payloads[0].distinct_id).not.toBe(payloads[1].distinct_id);
    expect(payloads[0].properties).toEqual({ source: "website", page: "search", $process_person_profile: false, $geoip_disable: true, $ip: null, environment: "production", analytics_version: 1 });
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ "Content-Type": "application/json" });
  });
  it("does not send from previews, disabled settings or unknown hosts; failures are harmless", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("private upstream error"));
    expect(await captureEvent("test", {})).toBe(false);
    vi.stubEnv("VERCEL_ENV", "preview"); expect(analyticsEnabled()).toBe(false);
    expect(await captureEvent("test", {})).toBe(false); expect(fetcher).toHaveBeenCalledOnce();
    vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("POSTHOG_HOST", "http://localhost:3000"); expect(analyticsEnabled()).toBe(false);
  });
  it("constructs MCP metrics without inputs, results, network IDs, error messages or sessions", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    recordMcpOperation("check_product", "quota_exceeded", 1055, false);
    const callback = vi.mocked(after).mock.calls[0][0] as () => Promise<void>;
    await callback();
    const payload = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(payload.properties).toMatchObject({ source: "public_mcp", $mcp_tool_name: "check_product", $mcp_duration_ms: 1100, outcome: "quota_exceeded", $mcp_is_error: true });
    expect(Object.keys(payload.properties).sort()).toEqual(["source", "$mcp_server_name", "$mcp_tool_name", "$mcp_duration_ms", "outcome", "$mcp_is_error", "$process_person_profile", "$geoip_disable", "$ip", "environment", "analytics_version"].sort());
  });
});
