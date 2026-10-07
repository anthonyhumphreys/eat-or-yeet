import "server-only";

import { createHash } from "node:crypto";

import { fetchMutation } from "convex/nextjs";

import { api } from "@convex/_generated/api";
import { securitySecret } from "./config";

export type RateLimitAction = "check" | "share";
export type RateLimitScope = "anonymous" | "network";

const rules: Record<RateLimitAction, Record<RateLimitScope, number>> = {
  check: { anonymous: 120, network: 600 },
  share: { anonymous: 20, network: 100 },
};

export async function takeRateLimit(subject: string, action: RateLimitAction, scope: RateLimitScope) {
  const limit = rules[action][scope];
  const windowMs = 60 * 60 * 1000;
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const subjectHash = createHash("sha256")
    .update(`${securitySecret()}:${scope}:${subject}`)
    .digest("hex");
  const id = `${subjectHash}:${scope}:${action}:${bucket}`;
  const windowStartedAt = bucket * windowMs;
  const expiresAt = (bucket + 2) * windowMs;
  const count = await fetchMutation(api.rateLimits.take, {
    secret: process.env.CONVEX_SERVER_SECRET ?? "",
    key: id,
    subjectHash,
    action,
    windowStartedAt,
    expiresAt,
  });
  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt: new Date((bucket + 1) * windowMs),
  };
}
