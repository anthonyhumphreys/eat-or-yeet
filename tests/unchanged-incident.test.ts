import { describe, expect, it } from "vitest";

import { sameIncidentContent } from "@/lib/incidents/unchanged";

describe("unchanged warning imports", () => {
  it("ignores fetch bookkeeping and object ordering while retaining source content", () => {
    const existing = { title: "Recall", retrievedAt: 1, sourceRunId: "old", originalSourceData: { product: "Biscuits", codes: ["A", "B"] } };
    expect(sameIncidentContent(existing, { ...existing, retrievedAt: 2, sourceRunId: "new", originalSourceData: { codes: ["A", "B"], product: "Biscuits" } })).toBe(true);
  });

  it("detects changed source data, status and affected codes", () => {
    const existing = { status: "active", targets: [{ value: "A", notes: "Check pack" }], originalSourceData: { product: "Biscuits" } };
    for (const incoming of [
      { ...existing, status: "resolved" },
      { ...existing, targets: [{ value: "B", notes: "Check pack" }] },
      { ...existing, originalSourceData: { product: "Cookies" } },
    ]) expect(sameIncidentContent(existing, incoming)).toBe(false);
  });

  it("detects clearing optional fields and tolerates absent undefined fields", () => {
    expect(sameIncidentContent({ hazard: "Milk" }, { hazard: undefined })).toBe(false);
    expect(sameIncidentContent({}, { hazard: undefined })).toBe(true);
    expect(sameIncidentContent({ source: { hazard: "Milk" } }, { source: {} })).toBe(false);
  });
});
