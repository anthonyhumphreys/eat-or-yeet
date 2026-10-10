import "server-only";

import { createHash } from "node:crypto";

import { fetchMutation } from "convex/nextjs";

import { api } from "@convex/_generated/api";
import { securitySecret } from "./config";

export type IntegrationRateLimitAction = "mcp_check" | "mcp_browse" | "mcp_coverage" | "mcp_shopping";
export type IntegrationRateLimitScope = "network" | "global";

export type IntegrationRateLimitResult = {
  scope: IntegrationRateLimitScope;
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
};

const dailyGlobalLimits: Record<IntegrationRateLimitAction, number> = {
  mcp_check: 1_000,
  mcp_browse: 3_000,
  mcp_coverage: 2_000,
  mcp_shopping: 1_000,
};

const hourlyNetworkLimits: Record<IntegrationRateLimitAction, number> = {
  mcp_check: 300,
  mcp_browse: 900,
  mcp_coverage: 600,
  mcp_shopping: 300,
};

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;

function hashIdentity(salt: string, identity: string) {
  return createHash("sha256").update(`${salt}:integration:${identity}`).digest("hex");
}

function validCounts(counts: unknown, expectedLength: number): counts is number[] {
  return Array.isArray(counts)
    && counts.length === expectedLength
    && counts.every((count) => Number.isSafeInteger(count) && count >= 1);
}

/**
 * Consume an integration request's network and shared global allowance in one
 * atomic Convex mutation. `network` must come from the server's trusted proxy
 * parsing; callers must not pass a client-supplied host or user identifier.
 */
export async function takeIntegrationRateLimits(
  network: string,
  action: IntegrationRateLimitAction,
  units = 1,
): Promise<IntegrationRateLimitResult[]> {
  if (typeof network !== "string" || network.trim().length === 0 || network.length > 256) {
    throw new Error("A trusted integration network identity is required.");
  }
  if (!Number.isInteger(units) || units < 1 || units > 20) {
    throw new Error("Integration rate-limit units must be an integer from 1 to 20.");
  }

  const now = Date.now();
  const networkBucket = Math.floor(now / hourMs);
  const globalBucket = Math.floor(now / dayMs);
  const networkStartedAt = networkBucket * hourMs;
  const globalStartedAt = globalBucket * dayMs;
  const salt = securitySecret();
  const networkHash = hashIdentity(salt, `network:${network}`);
  const globalHash = hashIdentity(salt, "global");
  const secret = process.env.CONVEX_SERVER_SECRET ?? "";
  const buckets = [
    {
      key: `integration:${networkHash}:${action}:network:${networkBucket}`,
      subjectHash: networkHash,
      action,
      windowStartedAt: networkStartedAt,
      expiresAt: networkStartedAt + 2 * hourMs,
      cost: units,
      limit: hourlyNetworkLimits[action],
    },
    {
      key: `integration:${globalHash}:${action}:global:${globalBucket}`,
      subjectHash: globalHash,
      action,
      windowStartedAt: globalStartedAt,
      expiresAt: globalStartedAt + 2 * dayMs,
      cost: units,
      limit: dailyGlobalLimits[action],
    },
  ];

  const counts: unknown = await fetchMutation(api.rateLimits.takeMany, { secret, buckets });
  if (!validCounts(counts, buckets.length)) {
    throw new Error("The rate-limit datastore returned invalid counts.");
  }

  const [networkCount, globalCount] = counts;
  const networkLimit = hourlyNetworkLimits[action];
  const globalLimit = dailyGlobalLimits[action];
  return [
    {
      scope: "network",
      allowed: networkCount <= networkLimit,
      limit: networkLimit,
      remaining: Math.max(0, networkLimit - networkCount),
      resetAt: new Date(networkStartedAt + hourMs),
    },
    {
      scope: "global",
      allowed: globalCount <= globalLimit,
      limit: globalLimit,
      remaining: Math.max(0, globalLimit - globalCount),
      resetAt: new Date(globalStartedAt + dayMs),
    },
  ];
}
