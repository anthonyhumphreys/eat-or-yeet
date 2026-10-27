import {
  MAX_SOURCE_JSON_BYTES,
  MAX_SOURCE_TEXT_BYTES,
  readResponseJson,
  readResponseText,
} from "@/lib/http/bounded-response";

type OfficialSourceRequestOptions = {
  sourceName: string;
  headers?: HeadersInit;
  timeoutMs?: number;
  cache?: RequestCache;
  /** The caller must validate the source's explicit no-results JSON response. */
  allowNotFound?: boolean;
};

const MAX_ATTEMPTS = 3;

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchOfficialResponse(
  url: string,
  options: OfficialSourceRequestOptions,
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: options.headers,
        cache: options.cache,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_ATTEMPTS) {
        await pause(attempt * 250);
        continue;
      }
      break;
    }

    if (response.ok || (options.allowNotFound && response.status === 404)) return response;

    lastError = new Error(`${options.sourceName} returned HTTP ${response.status} for ${url}`);
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) throw lastError;
    await pause(attempt * 250);
  }

  throw new Error(`${options.sourceName} request failed after ${MAX_ATTEMPTS} attempts for ${url}`, {
    cause: lastError,
  });
}

export async function fetchOfficialJson(
  url: string,
  options: OfficialSourceRequestOptions,
): Promise<unknown> {
  const response = await fetchOfficialResponse(url, options);
  try {
    return await readResponseJson(response, MAX_SOURCE_JSON_BYTES);
  } catch (error) {
    throw new Error(`${options.sourceName} returned an invalid or oversized JSON response for ${url}`, { cause: error });
  }
}

export async function fetchOfficialText(
  url: string,
  options: OfficialSourceRequestOptions,
): Promise<string> {
  const response = await fetchOfficialResponse(url, options);
  try {
    return await readResponseText(response, MAX_SOURCE_TEXT_BYTES);
  } catch (error) {
    throw new Error(`${options.sourceName} returned an invalid or oversized text response for ${url}`, { cause: error });
  }
}
