import "server-only";

import { randomBytes } from "node:crypto";

let developmentSecret: string | undefined;

/** Returns a deployment secret, using a per-process secret only outside production. */
export function securitySecret(): string {
  const configured = process.env.RATE_LIMIT_SALT;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("RATE_LIMIT_SALT is not configured");
  }

  developmentSecret ??= randomBytes(32).toString("base64url");
  return developmentSecret;
}
