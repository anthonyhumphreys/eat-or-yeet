export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "too_large" | "invalid_json" };

/** Reads a request body without buffering more than the supplied byte limit. */
export async function readBoundedJson(request: Request, maxBytes: number): Promise<BoundedJsonResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    return { ok: false, reason: "too_large" };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: "invalid_json" };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }

    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid_json" };
  } finally {
    reader.releaseLock();
  }
}
