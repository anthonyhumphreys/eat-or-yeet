export const MAX_SOURCE_JSON_BYTES = 20 * 1024 * 1024;
export const MAX_SOURCE_TEXT_BYTES = 2 * 1024 * 1024;

export class ResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Response exceeds the ${maxBytes}-byte limit`);
    this.name = "ResponseTooLargeError";
  }
}

function contentLength(response: Response): number | null {
  const header = response.headers.get("content-length");
  if (header === null) return null;
  if (!/^\d+$/.test(header.trim())) throw new Error("Response has an invalid Content-Length header");
  const length = Number(header);
  if (!Number.isSafeInteger(length)) throw new Error("Response Content-Length is outside the safe integer range");
  return length;
}

export async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("maxBytes must be a positive safe integer");
  const declaredLength = contentLength(response);
  if (declaredLength !== null && declaredLength > maxBytes) throw new ResponseTooLargeError(maxBytes);
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let receivedBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        throw new ResponseTooLargeError(maxBytes);
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // The stream may already be cancelled or closed.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function readResponseJson<T = unknown>(response: Response, maxBytes = MAX_SOURCE_JSON_BYTES): Promise<T> {
  const text = await readResponseText(response, maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error("Response body is not valid JSON", { cause: error });
  }
}
