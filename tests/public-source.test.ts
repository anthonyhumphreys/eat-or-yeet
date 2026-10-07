import { describe, expect, it } from "vitest";

import { publicOfficialSource } from "@/lib/incidents/public-source";

describe("public official sources", () => {
  it("replaces raw FDA enforcement API links with a public report and lookup instructions", () => {
    const source = publicOfficialSource({ authority: "U.S. Food and Drug Administration", authorityUrl: "https://api.fda.gov/food/enforcement.json?search=recall_number:R-123", sourceId: "R-123" });
    expect(source.url).toBe("https://www.accessdata.fda.gov/scripts/ires/index.cfm#/search/");
    expect(source.note).toContain("R-123");
  });

  it("keeps direct FDA announcement and FSIS public links", () => {
    for (const [authority, url] of [
      ["U.S. Food and Drug Administration", "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/sample-recall"],
      ["USDA FSIS", "https://www.fsis.usda.gov/recalls-alerts/sample-recall"],
    ]) expect(publicOfficialSource({ authority, authorityUrl: url, sourceId: "sample" }).url).toBe(url);
  });

  it("moves old FSA and data links to the current consumer alert page", () => {
    expect(publicOfficialSource({ authority: "Food Standards Agency", authorityUrl: "https://data.food.gov.uk/food-alerts/id/FSA-PRIN-29-2026", sourceId: "FSA-PRIN-29-2026" }).url).toBe("https://alerts.food.gov.uk/news-alerts/alert/FSA-PRIN-29-2026");
  });

  it("does not turn untrusted source URLs or malformed identifiers into outbound links", () => {
    expect(publicOfficialSource({ authority: "Food Standards Agency", authorityUrl: "javascript:alert(1)", sourceId: "../../example" }).url).toBe("https://alerts.food.gov.uk/");
    expect(publicOfficialSource({ authority: "U.S. Food and Drug Administration", authorityUrl: "https://www.fda.gov.evil.example/recall", sourceId: "example" }).url).toContain("accessdata.fda.gov");
  });
});
