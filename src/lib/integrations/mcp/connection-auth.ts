import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

export type McpConnection = { id: string; dailyLimit: number };
export type McpConnectionAuth =
  | { ok: true; connection: McpConnection }
  | { ok: false; status: 401 | 503 };

type ConfiguredConnection = McpConnection & { sha256: string; expiresAt: number };

const connectionIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function parseConnectionKeys(raw: string | undefined): ConfiguredConnection[] | null {
  if (!raw || Buffer.byteLength(raw, "utf8") > 16 * 1024) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;

  const ids = new Set<string>();
  const hashes = new Set<string>();
  const parsed: ConfiguredConnection[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "dailyLimit,expiresAt,id,sha256") return null;
    if (typeof record.id !== "string" || !connectionIdPattern.test(record.id) || ids.has(record.id)) return null;
    if (typeof record.sha256 !== "string" || !/^[0-9a-fA-F]{64}$/.test(record.sha256)) return null;
    const sha256 = record.sha256.toLowerCase();
    if (hashes.has(sha256)) return null;
    if (!Number.isSafeInteger(record.dailyLimit) || (record.dailyLimit as number) < 1 || (record.dailyLimit as number) > 1_000) return null;
    if (typeof record.expiresAt !== "string" || !isoTimestampPattern.test(record.expiresAt)) return null;
    const expiresAt = Date.parse(record.expiresAt);
    const date = new Date(expiresAt);
    const timestamp = record.expiresAt.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/);
    if (!Number.isFinite(expiresAt) || !timestamp || date.toISOString().slice(0, 19) !== timestamp[1] ||
        date.toISOString().slice(20, 23) !== (timestamp[2] ?? "").padEnd(3, "0")) return null;
    ids.add(record.id);
    hashes.add(sha256);
    parsed.push({ id: record.id, sha256, dailyLimit: record.dailyLimit as number, expiresAt });
  }
  return parsed;
}

/** Checks the revocable connection list without exposing its contents in errors or logs. */
export function authenticateMcpConnection(request: Request, raw = process.env.MCP_CONNECTION_KEYS): McpConnectionAuth {
  const configured = parseConnectionKeys(raw);
  if (!configured) return { ok: false, status: 503 };

  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([-A-Za-z0-9._~+/=]{1,512})$/);
  if (!match) return { ok: false, status: 401 };
  const tokenHash = createHash("sha256").update(match[1]).digest();
  const now = Date.now();
  let selected: ConfiguredConnection | undefined;
  // Compare every configured digest to avoid revealing which key was found.
  for (const connection of configured) {
    const expected = Buffer.from(connection.sha256, "hex");
    if (timingSafeEqual(tokenHash, expected) && connection.expiresAt > now) selected = connection;
  }
  if (!selected) return { ok: false, status: 401 };
  return { ok: true, connection: { id: selected.id, dailyLimit: selected.dailyLimit } };
}
