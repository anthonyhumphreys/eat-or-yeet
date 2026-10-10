import { describe, expect, it, vi } from "vitest";

import { categoryLookupDue, fetchOffCategoryTags, lookupBarcode, pendingLookupDue, productCategoryTagsFor } from "@/lib/products/open-food-facts";

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("Open Food Facts category lookups", () => {
  it("asks for the printed barcode and keeps only the tags the mapping uses", async () => {
    const fetcher = reply(200, { status: 1, product: { categories_tags: ["en:snacks", "en:salty-snacks", "en:crisps", "en:snacks"] } });
    expect(await fetchOffCategoryTags("05000328657950", fetcher as unknown as typeof fetch)).toEqual({ status: "found", tags: ["en:snacks"] });
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toContain("/product/5000328657950.json?fields=categories_tags");
  });

  it("records a barcode Open Food Facts does not know, or knows without useful categories", async () => {
    expect(await fetchOffCategoryTags("05000328657950", reply(404, { status: 0 }) as unknown as typeof fetch)).toEqual({ status: "missing" });
    expect(await fetchOffCategoryTags("05000328657950", reply(200, { status: 0 }) as unknown as typeof fetch)).toEqual({ status: "missing" });
    expect(await fetchOffCategoryTags("05000328657950", reply(200, { status: 1, product: { categories_tags: ["en:doughnuts-only"] } }) as unknown as typeof fetch)).toEqual({ status: "missing" });
  });

  it("returns null on failures so the barcode is retried rather than marked missing", async () => {
    expect(await fetchOffCategoryTags("05000328657950", reply(503, {}) as unknown as typeof fetch)).toBeNull();
    expect(await fetchOffCategoryTags("05000328657950", vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
    expect(await fetchOffCategoryTags("05000328657950", vi.fn(async () => new Response("not json", { status: 200 })) as unknown as typeof fetch)).toBeNull();
  });

  it("orders unchecked barcodes newest first, before any recheck", () => {
    const now = Date.parse("2026-10-09T12:00:00Z");
    expect(pendingLookupDue(Date.parse("2026-10-08T00:00:00Z"))).toBeLessThan(pendingLookupDue(Date.parse("2026-01-01T00:00:00Z")));
    expect(pendingLookupDue(now)).toBeLessThan(0);
    expect(categoryLookupDue(null, now)).toBe(now + 86_400_000);
    expect(categoryLookupDue({ status: "missing" }, now)).toBe(now + 30 * 86_400_000);
    expect(categoryLookupDue({ status: "found", tags: ["en:snacks"] }, now)).toBe(now + 90 * 86_400_000);
  });

  it("attaches cached tags only for a notice's own barcodes", () => {
    const cached = new Map([["05000328657950", ["en:snacks"]]]);
    expect(productCategoryTagsFor([{ type: "gtin", valueNormalized: "05000328657950" }, { type: "product" }], cached)).toEqual({ "05000328657950": ["en:snacks"] });
    expect(productCategoryTagsFor([{ type: "gtin", valueNormalized: "00044000061494" }], cached)).toBeUndefined();
  });

  it("strips GTIN-14 padding back to the printed code", () => {
    expect(lookupBarcode("00044000061494")).toBe("044000061494");
    expect(lookupBarcode("00000000797016")).toBe("00797016");
  });
});
