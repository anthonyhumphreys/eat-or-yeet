import { describe, expect, it } from "vitest";

import { isValidGtin } from "../src/lib/domain/gtin";
import {
  beginRequest,
  cancelRequest,
  commitRequest,
  draftFromUnknown,
  emptyDraft,
  failRequest,
  initialRequestState,
  makeCheckInput,
  emptySubmittedObservation,
  validCalendarDate,
} from "../apps/eat-or-yeet/src/state";

describe("MCP app state", () => {
  it("binds a completed result to the input snapshot, not later draft edits", () => {
    const draft = { ...emptyDraft(), barcode: "4006381333931" };
    const request = makeCheckInput(draft, "UK", isValidGtin);
    expect(request.ok).toBe(true);
    const pending = beginRequest(initialRequestState(), 1, "check_product");
    const committed = commitRequest(pending, 1, {
      tool: "check_product",
      input: request.ok ? request.value : null,
      result: { status: "no_matching_warning" },
    });

    draft.barcode = "5012345678900";
    expect(committed.completed?.input).toEqual({
      region: "UK",
      observation: expect.objectContaining({ barcode: "4006381333931" }),
    });
    expect(committed.completed?.result).toEqual({ status: "no_matching_warning" });
  });

  it("does not commit stale, failed, or interrupted requests over the previous result", () => {
    const previous = {
      tool: "check_product" as const,
      input: { region: "US" },
      result: { status: "warning_match" },
    };
    const state = { ...initialRequestState(), completed: previous };
    const pending = beginRequest(state, 4, "check_product");
    expect(commitRequest(pending, 3, { ...previous, result: { status: "no_matching_warning" } })).toBe(pending);
    expect(failRequest(pending, 4, "The warning service is unavailable.").completed).toBe(previous);
    expect(cancelRequest(pending, 4).completed).toBe(previous);
  });

  it("accepts only real calendar dates and maps host evidence into the editor", () => {
    expect(validCalendarDate("2024-02-29")).toBe(true);
    expect(validCalendarDate("2025-02-29")).toBe(false);
    expect(draftFromUnknown({
      productName: "Soup",
      barcode: 123,
      dates: { useBy: "2025-01-03", bestBefore: null },
    })).toEqual({
      productName: "Soup", brand: "", barcode: "", batchCode: "", lotCode: "",
      useBy: "2025-01-03", bestBefore: "",
    });
  });

  it("rejects malformed GTINs and calendar dates before a tool call can be prepared", () => {
    const invalidBarcode = makeCheckInput({ ...emptyDraft(), barcode: "4006381333932" }, "US", isValidGtin);
    expect(invalidBarcode).toEqual({ ok: false, message: "Enter a valid GTIN barcode, or clear the field." });
    const invalidDate = makeCheckInput({ ...emptyDraft(), productName: "Soup", useBy: "2025-02-29" }, "UK", isValidGtin);
    expect(invalidDate).toEqual({ ok: false, message: "Use-by must be a real date in YYYY-MM-DD format." });
    expect(makeCheckInput({ ...emptyDraft(), barcode: "4006381333931" }, "US", isValidGtin).ok).toBe(true);
  });

  it("retains validated submitted facts while edited fields override their submitted values", () => {
    const submitted = {
      ...emptySubmittedObservation(),
      productName: "Soup",
      batchCode: "BATCH-OLD",
      countryOfOrigin: "United Kingdom",
      producer: "Example Foods",
      dates: { useBy: "2026-10-30", bestBefore: null, productionDate: "2026-10-01" },
    };
    const input = makeCheckInput({
      ...emptyDraft(),
      productName: "Soup, revised",
      batchCode: "BATCH-NEW",
      useBy: "2026-10-31",
    }, "UK", isValidGtin, submitted);

    expect(input.ok).toBe(true);
    if (!input.ok) return;
    expect(input.value.observation).toMatchObject({
      productName: "Soup, revised",
      batchCode: "BATCH-NEW",
      countryOfOrigin: "United Kingdom",
      producer: "Example Foods",
      dates: { useBy: "2026-10-31", productionDate: "2026-10-01" },
    });
  });

  it("rejects cleared editable evidence but allows retained producer or production-date facts", () => {
    const submittedEditable = {
      ...emptySubmittedObservation(),
      barcode: "4006381333931",
      productName: "Soup",
      brand: "Example",
    };
    expect(makeCheckInput(emptyDraft(), "UK", isValidGtin, submittedEditable)).toEqual({
      ok: false,
      message: "Add a barcode or a label detail before checking.",
    });

    const producerOnly = { ...emptySubmittedObservation(), producer: "Example Foods" };
    expect(makeCheckInput(emptyDraft(), "UK", isValidGtin, producerOnly).ok).toBe(true);

    const productionDateOnly = {
      ...emptySubmittedObservation(),
      dates: { useBy: null, bestBefore: null, productionDate: "2026-10-01" },
    };
    expect(makeCheckInput(emptyDraft(), "UK", isValidGtin, productionDateOnly).ok).toBe(true);
  });
});
