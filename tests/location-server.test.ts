import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookie: vi.fn(), header: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookie }),
  headers: async () => ({ get: mocks.header }),
}));

import { getPreferredRegion, getSavedRegion, getSuggestedRegion } from "@/lib/location-server";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("request region preferences", () => {
  it("keeps a saved choice separate from a conflicting country suggestion", async () => {
    mocks.cookie.mockReturnValue({ value: "UK" });
    mocks.header.mockReturnValue("US");
    expect(await getSavedRegion()).toBe("UK");
    expect(await getPreferredRegion()).toBe("UK");
    expect(await getSuggestedRegion()).toBe("US");
    expect(mocks.header).toHaveBeenCalledWith("x-vercel-ip-country");
  });

  it("distinguishes a default region from a confirmed preference", async () => {
    expect(await getSavedRegion()).toBeUndefined();
    expect(await getPreferredRegion()).toBe("UK");
    expect(await getSuggestedRegion()).toBeUndefined();
  });

  it("ignores unsupported saved regions and request countries", async () => {
    mocks.cookie.mockReturnValue({ value: "CA" });
    mocks.header.mockReturnValue("CA");
    expect(await getSavedRegion()).toBeUndefined();
    expect(await getSuggestedRegion()).toBeUndefined();
  });
});
