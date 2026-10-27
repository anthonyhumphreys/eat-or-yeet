import { describe, expect, it } from "vitest";
import { browseReturnUrl, filterUrl } from "@/lib/incidents/browse-navigation";

describe("browse return URLs", () => {
  it("retains bounded recognized filters and page state", () => {
    const url = filterUrl("/incidents", "UK", { q: "milk chocolate", hazard: "allergen", type: "Food", category: "Snacks & sweets", store: "Waitrose" }, 3);
    expect(browseReturnUrl(url)).toBe(url);
    expect(browseReturnUrl("/?region=US&page=3&unknown=ignored")).toBe("/?region=US&page=3");
  });
  it.each(["https://attacker.example/", "//attacker.example/", "/\\attacker.example/", "/search?region=UK", "/incidents/recall?region=UK", "/?region=invalid", "/?region=UK#unexpected", undefined, ["/?region=UK"]])("rejects an invalid return target %s", (value) => {
    expect(browseReturnUrl(value)).toBeNull();
  });
  it("drops invalid filters and bounds user-controlled values", () => {
    const url = browseReturnUrl(`/?region=UK&q=${"x".repeat(150)}&store=${"y".repeat(150)}&page=-1&hazard=invalid&type=invalid&category=invalid`)!;
    const params = new URL(url, "https://fixture.test").searchParams;
    expect(params.get("q")).toHaveLength(120);
    expect(params.get("store")).toHaveLength(120);
    expect(params.has("page")).toBe(false);
    expect(params.has("hazard")).toBe(false);
  });
});
