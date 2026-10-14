import { beforeEach, describe, expect, it, vi } from "vitest";

import { emptyObservation } from "@/lib/domain/schemas";
import { enrichObservation } from "@/lib/products/enrich";
import oreoMetadata from "./fixtures/open-food-facts-oreo.json";

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("@backend/client", () => ({ fetchQuery: mocks.query, fetchMutation: mocks.mutation }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("product lookup evidence", () => {
  it.each(["044000061494", "0044000061494", "00044000061494"])("identifies Oreo barcode %s from its real lookup metadata", async (barcode) => {
    mocks.query.mockResolvedValueOnce({ product: null, metadata: null });
    mocks.mutation.mockResolvedValue(null);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(oreoMetadata)));
    vi.stubGlobal("fetch", fetcher);

    const result = await enrichObservation({ ...emptyObservation(), barcode });

    expect(fetcher.mock.calls[0][0]).toContain(`/${barcode === "0044000061494" ? barcode : "044000061494"}.json`);
    expect(result).toMatchObject({ barcode: "00044000061494", productName: "Oreo", brand: "Mondelez International" });
    expect(mocks.mutation.mock.calls[0][1].gtin).toBe("00044000061494");
  });

  it("does not infer a producer or country of origin from sale metadata", async () => {
    mocks.query.mockResolvedValueOnce({ product: null, metadata: null });
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
    mocks.query.mockResolvedValueOnce({ product: null, metadata: { metadata: null } });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = await enrichObservation({ ...emptyObservation(), barcode: "4006381333931" });
    expect(result.productName).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps manually supplied details when recognised lookup metadata is present", async () => {
    mocks.query.mockResolvedValueOnce({ product: null, metadata: { metadata: { product_name: "Lookup name", brands: "Lookup brand" } } });
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
    mocks.query.mockResolvedValueOnce({ product: null, metadata: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(65 * 1024))));
    const result = await enrichObservation({ ...emptyObservation(), barcode: "4006381333931" });
    expect(result.productName).toBeNull();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("looks up a padded GTIN using the printed barcode format", async () => {
    mocks.query.mockResolvedValueOnce({ product: null, metadata: null });
    mocks.mutation.mockResolvedValue(null);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 0 })));
    vi.stubGlobal("fetch", fetcher);
    await enrichObservation({ ...emptyObservation(), barcode: "04006381333931" });
    expect(fetcher.mock.calls[0][0]).toContain("/4006381333931.json");
    expect(mocks.mutation.mock.calls[0][1].metadata).toBeNull();
  });

  it("uses a local product before any external metadata", async () => {
    mocks.query.mockResolvedValueOnce({
      product: { name: "Curated name", brand: "Curated brand", producer: "Maker", countryOfOrigin: "UK", category: "Biscuits" },
      metadata: null,
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    const result = await enrichObservation({ ...emptyObservation(), barcode: "4006381333931" });

    expect(result).toMatchObject({ productName: "Curated name", brand: "Curated brand", producer: "Maker", countryOfOrigin: "UK", category: "Biscuits" });
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not start lookup, fetch, or cache writes for an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(enrichObservation(
      { ...emptyObservation(), barcode: "4006381333931" },
      { signal: controller.signal },
    )).rejects.toHaveProperty("name", "AbortError");

    expect(mocks.query).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("skips external lookup and cache writes if cancellation arrives during the backend query", async () => {
    const controller = new AbortController();
    let finishQuery!: (result: { product: null; metadata: null }) => void;
    mocks.query.mockImplementationOnce(() => new Promise((resolve) => {
      finishQuery = resolve;
    }));
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const pending = enrichObservation(
      { ...emptyObservation(), barcode: "4006381333931" },
      { signal: controller.signal },
    );

    controller.abort();
    finishQuery({ product: null, metadata: null });

    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("propagates caller cancellation during the Open Food Facts request without caching", async () => {
    const controller = new AbortController();
    mocks.query.mockResolvedValueOnce({ product: null, metadata: null });
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetcher);

    const pending = enrichObservation(
      { ...emptyObservation(), barcode: "4006381333931" },
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const requestSignal = vi.mocked(fetcher).mock.calls[0][1]?.signal;
    controller.abort();

    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    expect(requestSignal?.aborted).toBe(true);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("keeps timeout failures as best-effort enrichment misses", async () => {
    mocks.query.mockResolvedValueOnce({ product: null, metadata: null });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")));

    const result = await enrichObservation({ ...emptyObservation(), barcode: "4006381333931" });

    expect(result).toMatchObject({ barcode: "04006381333931", productName: null, brand: null });
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("treats an expired cache row as a miss", async () => {
    const { createBackend } = await import("./backend-harness");
    const { api } = await import("../backend/api");
    const t = createBackend();
    await t.run((ctx) => ctx.db.insert("productMetadataCache", {
      gtin: "0004006381333931", source: "openfoodfacts", metadata: { product_name: "Old name" },
      expiresAt: Date.now() - 1, updatedAt: Date.now() - 2,
    }));
    await expect(t.query(api.products.lookupByGtin, { gtin: "0004006381333931" })).resolves.toEqual({ product: null, metadata: null });

  });
});
