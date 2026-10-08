import { MAX_SOURCE_JSON_BYTES } from "@/lib/http/bounded-response";

export const MAX_FSIS_SNAPSHOT_AGE_MS = 15 * 60 * 1_000;

export async function readFsisSnapshot(blob: Blob | null, fetchedAt: number, now = Date.now()): Promise<unknown> {
  if (!Number.isSafeInteger(fetchedAt) || fetchedAt > now || now - fetchedAt > MAX_FSIS_SNAPSHOT_AGE_MS) {
    throw new Error("FSIS snapshot must have been fetched within the last 15 minutes");
  }
  if (!blob || !blob.size || blob.size > MAX_SOURCE_JSON_BYTES) {
    throw new Error("FSIS snapshot is missing, empty or too large");
  }
  return JSON.parse(await blob.text()) as unknown;
}
