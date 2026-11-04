import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("document", { cookie: "eat-or-yeet-analytics=v1.accepted" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});
afterEach(() => vi.unstubAllGlobals());

describe("deferred browser analytics", () => {
  it("does not send a queued event when consent is withdrawn during module loading", async () => {
    const analytics = await import("@/lib/analytics/browser");
    analytics.configureBrowserAnalytics(true);
    analytics.trackWebsiteEvent({ event: "website_page_viewed", page: "home" });
    analytics.stopBrowserAnalytics();
    await import("@/lib/analytics/contracts");
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still validates exact event properties before transmitting", async () => {
    const analytics = await import("@/lib/analytics/browser");
    analytics.configureBrowserAnalytics(true);
    const input = { event: "website_page_viewed", page: "home", productName: "private pack" } as const;
    analytics.trackWebsiteEvent(input);
    analytics.trackWebsiteEvent({ event: "website_page_viewed", page: "search" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/analytics");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ data: { event: "website_page_viewed", page: "search" } });
  });

  it("honours privacy signals before loading or sending an event", async () => {
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    const analytics = await import("@/lib/analytics/browser");
    analytics.configureBrowserAnalytics(true);
    analytics.trackWebsiteEvent({ event: "website_page_viewed", page: "home" });
    await import("@/lib/analytics/contracts");
    expect(fetch).not.toHaveBeenCalled();
  });
});
