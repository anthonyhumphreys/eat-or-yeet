import { beforeEach, describe, expect, it, vi } from "vitest";

import { emptyObservation } from "@/lib/domain/schemas";
import { enrichObservation } from "@/lib/products/enrich";

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("convex/nextjs", () => ({ fetchQuery: mocks.query, fetchMutation: mocks.mutation }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("product lookup evidence", () => {
  it("does not infer a producer or country of origin from sale metadata", async () => {
    mocks.query.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mocks.mutation.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 1,
      product: { product_name: "Cereal", brands: "Brand", countries: "France", manufacturing_places: "Factory district" },
    }))));
    const result = await enrichObservation({ ...emptyObservation(), barcode: "4006381333931" });
    expect(result.productName).toBe("Cereal");
    expect(result.countryOfOrigin).toBeNull();
    expect(result.producer).toBeNull();
  });

  it("honours a cached unknown barcode without repeating the external lookup", async () => {
    mocks.query.mockResolvedValueOnce(null).mockResolvedValueOnce({ metadata: null });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = await enrichObservation({ ...emptyObservation(), barcode: "4006381333931" });
    expect(result.productName).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps manually supplied details when recognised lookup metadata is present", async () => {
    mocks.query.mockResolvedValueOnce(null).mockResolvedValueOnce({ metadata: { product_name: "Lookup name", brands: "Lookup brand" } });
    const result = await enrichObservation({ ...emptyObservation(), barcode: "4006381333931", productName: "Label name", countryOfOrigin: "UK" });
    expect(result.productName).toBe("Label name");
    expect(result.countryOfOrigin).toBe("UK");
    expect(result.brand).toBe("Lookup brand");
  });

  it("does not send invalid barcodes to the metadata service", async () => {
    await enrichObservation({ ...emptyObservation(), barcode: "123" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("does not parse or cache an oversized metadata response", async () => {
    mocks.query.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(65 * 1024))));
    const result = await enrichObservation({ ...emptyObservation(), barcode: "4006381333931" });
    expect(result.productName).toBeNull();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("looks up a padded GTIN using the printed barcode format", async () => {
    mocks.query.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mocks.mutation.mockResolvedValue(null);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 0 })));
    vi.stubGlobal("fetch", fetcher);
    await enrichObservation({ ...emptyObservation(), barcode: "04006381333931" });
    expect(fetcher.mock.calls[0][0]).toContain("/4006381333931.json");
    expect(mocks.mutation.mock.calls[0][1].metadata).toBeNull();
  });
});
