import "server-only";

import { createHash } from "node:crypto";

import { fetchMutation } from "convex/nextjs";

import { api } from "@convex/_generated/api";

type RateLimitRule = { limit: number; windowMs: number };

const rules: Record<string, RateLimitRule> = {
  analyse: { limit: 10, windowMs: 60 * 60 * 1000 },
  check: { limit: 120, windowMs: 60 * 60 * 1000 },
  share: { limit: 20, windowMs: 60 * 60 * 1000 },
};

export async function takeRateLimit(subject: string, action: keyof typeof rules) {
  const rule = rules[action];
  const now = Date.now();
  const bucket = Math.floor(now / rule.windowMs);
  const subjectHash = createHash("sha256")
    .update(`${process.env.RATE_LIMIT_SALT ?? "local"}:${subject}`)
    .digest("hex");
  const id = `${subjectHash}:${action}:${bucket}`;
  const windowStartedAt = bucket * rule.windowMs;
  const expiresAt = (bucket + 2) * rule.windowMs;
  const count = await fetchMutation(api.rateLimits.take, {
    secret: process.env.CONVEX_SERVER_SECRET ?? "",
    key: id,
    subjectHash,
    action,
    windowStartedAt,
    expiresAt,
  });
  return {
    allowed: count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetAt: new Date((bucket + 1) * rule.windowMs),
  };
}
