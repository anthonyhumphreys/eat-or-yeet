import { describe, expect, it } from "vitest";

import { MAX_SOURCE_JSON_BYTES } from "@/lib/http/bounded-response";
import { MAX_FSIS_SNAPSHOT_AGE_MS, readFsisSnapshot } from "@/lib/incidents/fsis-snapshot";

const now = Date.parse("2026-10-08T22:00:00Z");

describe("USDA snapshot transport", () => {
  it("reads a fresh JSON snapshot without changing the source records", async () => {
    const records = [{ langcode: "English", field_active_notice: "TRUE" }];
    await expect(readFsisSnapshot(new Blob([JSON.stringify(records)]), now - 5_000, now)).resolves.toEqual(records);
  });

  it.each([now + 1, now - MAX_FSIS_SNAPSHOT_AGE_MS - 1, NaN, Infinity, 1.5])("rejects a stale or invalid fetch time %s", async (fetchedAt) => {
    await expect(readFsisSnapshot(new Blob(["[]"]), fetchedAt, now)).rejects.toThrow("last 15 minutes");
  });

  it("rejects missing, empty, oversized and malformed files", async () => {
    await expect(readFsisSnapshot(null, now, now)).rejects.toThrow("missing");
    await expect(readFsisSnapshot(new Blob(), now, now)).rejects.toThrow("empty");
    await expect(readFsisSnapshot(new Blob([new Uint8Array(MAX_SOURCE_JSON_BYTES + 1)]), now, now)).rejects.toThrow("too large");
    await expect(readFsisSnapshot(new Blob(["not JSON"]), now, now)).rejects.toThrow();
  });
});
