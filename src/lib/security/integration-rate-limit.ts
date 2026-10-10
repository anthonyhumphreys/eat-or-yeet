import "server-only";

import { createHash } from "node:crypto";

import { fetchMutation } from "convex/nextjs";

import { api } from "@convex/_generated/api";
import { securitySecret } from "./config";

export type IntegrationRateLimitAction = "mcp_check" | "mcp_browse" | "mcp_coverage" | "mcp_shopping";
export type IntegrationRateLimitScope = "network" | "global" | "connection";

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
  connection?: { id: string; dailyLimit: number },
): Promise<IntegrationRateLimitResult[]> {
  if (typeof network !== "string" || network.trim().length === 0 || network.length > 256) {
    throw new Error("A trusted integration network identity is required.");
  }
  if (!Number.isInteger(units) || units < 1 || units > 20) {
    throw new Error("Integration rate-limit units must be an integer from 1 to 20.");
  }
  if (connection && (!/^[A-Za-z0-9_-]{1,64}$/.test(connection.id) || !Number.isSafeInteger(connection.dailyLimit) || connection.dailyLimit < 1 || connection.dailyLimit > 1_000)) {
    throw new Error("A valid private integration connection quota is required.");
  }

  const now = Date.now();
  const quotaAction = connection ? "mcp_shopping" : action;
  const networkBucket = Math.floor(now / hourMs);
  const globalBucket = Math.floor(now / dayMs);
  const networkWindowMs = hourMs;
  const networkStartedAt = networkBucket * networkWindowMs;
  const globalStartedAt = globalBucket * dayMs;
  const salt = securitySecret();
  const networkHash = hashIdentity(salt, `network:${network}`);
  const globalHash = hashIdentity(salt, "global");
  const secret = process.env.CONVEX_SERVER_SECRET ?? "";
  const connectionHash = connection ? hashIdentity(salt, `connection:${connection.id}`) : null;
  const buckets = [
    {
      key: connection
        ? `integration:${networkHash}:${quotaAction}:network:${networkBucket}`
        : `integration:${networkHash}:${action}:network:${networkBucket}`,
      subjectHash: networkHash,
      action: quotaAction,
      windowStartedAt: networkStartedAt,
      expiresAt: networkStartedAt + 2 * networkWindowMs,
      cost: units,
      limit: hourlyNetworkLimits[quotaAction],
    },
    {
      key: `integration:${globalHash}:${quotaAction}:global:${globalBucket}`,
      subjectHash: globalHash,
      action: quotaAction,
      windowStartedAt: globalStartedAt,
      expiresAt: globalStartedAt + 2 * dayMs,
      cost: units,
      limit: dailyGlobalLimits[quotaAction],
    },
  ];
  if (connection && connectionHash) {
    buckets.push({
      key: `integration:${connectionHash}:mcp_shopping:connection:${globalBucket}`,
      subjectHash: connectionHash,
      action: "mcp_shopping",
      windowStartedAt: globalStartedAt,
      expiresAt: globalStartedAt + 2 * dayMs,
      cost: units,
      limit: connection.dailyLimit,
    });
  }

  const counts: unknown = await fetchMutation(api.rateLimits.takeMany, { secret, buckets });
  if (!validCounts(counts, buckets.length)) {
    throw new Error("The rate-limit datastore returned invalid counts.");
  }

  const [networkCount, globalCount] = counts;
  const networkLimit = hourlyNetworkLimits[connection ? quotaAction : action];
  const globalLimit = dailyGlobalLimits[quotaAction];
  const results: IntegrationRateLimitResult[] = [
    {
      scope: "network",
      allowed: networkCount <= networkLimit,
      limit: networkLimit,
      remaining: Math.max(0, networkLimit - networkCount),
      resetAt: new Date(networkStartedAt + networkWindowMs),
    },
    {
      scope: "global",
      allowed: globalCount <= globalLimit,
      limit: globalLimit,
      remaining: Math.max(0, globalLimit - globalCount),
      resetAt: new Date(globalStartedAt + dayMs),
    },
  ];
  if (connection && counts.length === 3) {
    results.push({ scope: "connection", allowed: counts[2]! <= connection.dailyLimit, limit: connection.dailyLimit,
      remaining: Math.max(0, connection.dailyLimit - counts[2]!), resetAt: new Date(globalStartedAt + dayMs) });
  }
  return results;
}
