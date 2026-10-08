import { describe, expect, it } from "vitest";

import { regionFromCountryCode, suggestBrowserRegion } from "@/lib/location";

describe("region suggestions", () => {
  it("maps supported country hints without assuming UK for other countries", () => {
    expect(regionFromCountryCode("GB")).toBe("UK");
    expect(regionFromCountryCode("US")).toBe("US");
    expect(regionFromCountryCode("CA")).toBeUndefined();
    expect(regionFromCountryCode(null)).toBeUndefined();
  });

  it.each(["America/New_York", "America/Los_Angeles", "America/Phoenix", "Pacific/Honolulu", "US/Eastern"])(
    "suggests US from %s even with a UK browser language", (timeZone) => {
      expect(suggestBrowserRegion(["en-GB"], timeZone)).toBe("US");
    },
  );

  it("prefers a UK timezone over a US browser language", () => {
    expect(suggestBrowserRegion(["en-US"], "Europe/London")).toBe("UK");
  });

  it("uses an explicit browser locale when the timezone gives no supported hint", () => {
    expect(suggestBrowserRegion(["en-US"], "UTC")).toBe("US");
    expect(suggestBrowserRegion(["en", "en-GB"], "UTC")).toBe("UK");
  });

  it("does not equate all American timezones or English locales with the US", () => {
    expect(suggestBrowserRegion(["en-CA", "en-US"], "America/Toronto")).toBeUndefined();
    expect(suggestBrowserRegion(["en"], "America/Mexico_City")).toBeUndefined();
    expect(suggestBrowserRegion([], "UTC")).toBeUndefined();
    expect(suggestBrowserRegion(["invalid_locale"], "UTC")).toBeUndefined();
  });
});
