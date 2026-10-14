import type { OperationRef } from "./operations";
import { BackendError } from "./values";
import { readResponseJson } from "../src/lib/http/bounded-response";

export async function fetchQuery<A, R>(ref: OperationRef<A, R>, args: A, options: { url?: string; admin?: boolean } = {}): Promise<R> {
  const base = options.url ?? process.env.BACKEND_URL;
  const secret = options.admin ? process.env.BACKEND_ADMIN_TOKEN : process.env.BACKEND_SECRET;
  if (!base || !secret) throw new Error("BACKEND_URL and the backend credential are required.");
  const url = new URL(options.admin ? "/admin/rpc" : "/rpc", base);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) throw new Error("The backend requires HTTPS.");
  const response = await fetch(url, {
    method: "POST", headers: { "Authorization": `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ operation: ref.name, args }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60_000),
  });
  const body = await readResponseJson<unknown>(response, 2 * 1024 * 1024);
  if (!body || typeof body !== "object") throw new Error("Invalid backend response");
  if ("error" in body) throw new BackendError(body.error);
  if (!response.ok || !("result" in body)) throw new Error("The backend is unavailable");
  return body.result as R;
}
export const fetchMutation = fetchQuery;
export const fetchAction = fetchQuery;
