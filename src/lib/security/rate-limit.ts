import "server-only";

import { createHash } from "node:crypto";

import { fetchMutation } from "convex/nextjs";

import { api } from "@convex/_generated/api";
import { securitySecret } from "./config";

export type RateLimitAction = "check" | "share";
export type RateLimitScope = "anonymous" | "network";
export type RateLimitSubject = { subject: string; scope: RateLimitScope };

export type RateLimitResult = {
  scope: RateLimitScope;
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
};

const rules: Record<RateLimitAction, Record<RateLimitScope, number>> = {
  check: { anonymous: 120, network: 600 },
  share: { anonymous: 20, network: 100 },
};

export async function takeRateLimits(subjects: RateLimitSubject[], action: RateLimitAction): Promise<RateLimitResult[]> {
  if (subjects.length === 0) return [];
  const windowMs = 60 * 60 * 1000;
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const windowStartedAt = bucket * windowMs;
  const expiresAt = (bucket + 2) * windowMs;
  const secret = process.env.CONVEX_SERVER_SECRET ?? "";
  const salt = securitySecret();
  const buckets = subjects.map(({ subject, scope }) => {
    const subjectHash = createHash("sha256")
      .update(`${salt}:${scope}:${subject}`)
      .digest("hex");
    return {
      key: `${subjectHash}:${scope}:${action}:${bucket}`,
      subjectHash,
      action,
      windowStartedAt,
      expiresAt,
    };
  });
  const counts = await fetchMutation(api.rateLimits.takeMany, {
    secret,
    buckets,
  });
  if (!Array.isArray(counts) || counts.length !== buckets.length || counts.some((count) => !Number.isSafeInteger(count) || count < 1)) {
    throw new Error("The rate-limit datastore returned invalid counts.");
  }
  return subjects.map(({ scope }, index) => {
    const limit = rules[action][scope];
    const count = counts[index];
    return {
      scope,
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt: new Date((bucket + 1) * windowMs),
    };
  });
}

// Retain the original single-bucket helper for existing callers during rollout.
export async function takeRateLimit(subject: string, action: RateLimitAction, scope: RateLimitScope) {
  const [result] = await takeRateLimits([{ subject, scope }], action);
  if (!result) throw new Error("A rate-limit subject is required.");
  return {
    allowed: result.allowed,
    limit: result.limit,
    remaining: result.remaining,
    resetAt: result.resetAt,
  };
}
