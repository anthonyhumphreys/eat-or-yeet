"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { decryptCredentials, encryptCredentials } from "../integrations/notion/hosted/crypto";
import { NotionOAuthApi } from "../integrations/notion/managed/notion-api";
import {
  assertSelectedDatabase,
  buildWriteProperties,
  canReviewItem,
  McpReviewClient,
  NotionRestClient,
  parseRow,
  validateConfig,
  validateSelectedDataSource,
  WorkerError,
  type Fetcher,
  type PropertyConfig,
  type ReviewResponse,
  type ShoppingWorkerConfig,
} from "../integrations/notion/shopping-core";
import type { ListBinding, Region } from "../integrations/notion/managed/types";

const ACTION_DEADLINE_MS = 60_000;
const MAX_SETUP_ROWS = 1_000;
const DEFAULT_RETRY_MS = 30_000;
const MAX_RETRY_MS = 24 * 60 * 60 * 1_000;
const NOTION_ORIGIN = "https://api.notion.com";

type InstallationId = Id<"notionInstallations">;
type Scope = { workspaceId: string; ownerId: string };
type SetupClaim = {
  result: "claimed";
  leaseId: string;
  installationId: InstallationId;
  ownerId: string;
  workspaceId: string;
  generation: number;
  credentialRevision: number;
  credentialEnvelope: string;
  region: Region;
  templatePageId?: string;
  databaseId?: string;
  dataSourceId?: string;
  properties?: Record<string, { id: string; kind: "title" | "rich_text" | "checkbox" | "select" | "date" }> | null;
  statusLabels?: { found: string; none: string; unable: string } | null;
};

function persistedBinding(value: {
  templatePageId?: string;
  databaseId?: string;
  dataSourceId?: string;
  properties?: Record<string, { id: string; kind: "title" | "rich_text" | "checkbox" | "select" | "date" }> | null;
  statusLabels?: { found: string; none: string; unable: string } | null;
}): ListBinding | null {
  const { templatePageId, databaseId, dataSourceId, properties, statusLabels } = value;
  if (!templatePageId || !databaseId || !dataSourceId || !properties || !statusLabels) return null;
  const required: Record<string, PropertyConfig["kind"]> = {
    item: "title", relatedWarnings: "rich_text", reviewStatus: "select", reviewedAt: "date", inputFingerprint: "rich_text",
  };
  for (const [name, kind] of Object.entries(required)) {
    const property = properties[name];
    if (!property || typeof property.id !== "string" || !property.id || property.kind !== kind) return null;
  }
  for (const [name, property] of Object.entries(properties)) {
    if (!(name in required) && !["brand", "barcode", "bought", "batchCode", "lotCode", "producer", "countryOfOrigin", "establishmentNumber", "approvalNumber", "retailer", "useBy", "bestBefore", "productionDate"].includes(name)) return null;
    if (!property || typeof property.id !== "string" || !property.id) return null;
  }
  if (![statusLabels.found, statusLabels.none, statusLabels.unable].every((label) => typeof label === "string" && label.length > 0)) return null;
  return { templatePageId, databaseId, dataSourceId, properties: properties as ListBinding["properties"], statusLabels };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim() || value.length > 4_096) throw new WorkerError("Notion service configuration is incomplete", "invalid_config");
  return value;
}

function configFor(binding: ListBinding, region: Region): ShoppingWorkerConfig {
  const appUrl = new URL(requiredEnv("NEXT_PUBLIC_APP_URL"));
  if (appUrl.protocol !== "https:" && appUrl.hostname !== "localhost" && appUrl.hostname !== "127.0.0.1") {
    throw new WorkerError("Notion review service URL must use HTTPS", "invalid_config");
  }
  const reviewUrl = new URL("/mcp/notion", appUrl).href;
  const config = {
    listenHost: "127.0.0.1",
    listenPort: 1,
    statePath: "/not-used",
    notionApiToken: "managed-credential",
    notionWebhookVerificationToken: "managed-webhook",
    notionDataSourceId: binding.dataSourceId,
    notionDatabaseId: binding.databaseId,
    notionProperties: binding.properties,
    reviewMcpUrl: reviewUrl,
    reviewConnectionKey: requiredEnv("NOTION_REVIEW_CONNECTION_KEY"),
    reviewToolName: "review_shopping_items",
    region,
    statusLabels: binding.statusLabels,
  } satisfies ShoppingWorkerConfig;
  validateConfig(config);
  return config;
}

function oauthApi(fetcher?: Fetcher): NotionOAuthApi {
  const appUrl = new URL(requiredEnv("NEXT_PUBLIC_APP_URL"));
  const redirectUri = new URL("/api/notion/callback", appUrl).href;
  return new NotionOAuthApi(requiredEnv("NOTION_CLIENT_ID"), requiredEnv("NOTION_CLIENT_SECRET"), redirectUri, fetcher as typeof fetch | undefined);
}

function scopedCredentials(envelope: string, scope: Scope) {
  return decryptCredentials(envelope, scope, requiredEnv("NOTION_CREDENTIAL_KEY"));
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

async function connectReviewClient(client: McpReviewClient, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([client.connect(), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function closeReviewClient(client: McpReviewClient): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.close(),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, 1_000); }),
    ]);
  } catch {
    // Closing a timed-out remote transport must not retain the durable lease.
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeCode(error: unknown): string {
  if (error instanceof WorkerError) return error.code;
  if (isAbort(error)) return "temporary";
  return "temporary";
}

function retryAt(error: unknown, now: number): number {
  const requested = error instanceof WorkerError ? error.retryAfterMs : undefined;
  return now + Math.min(MAX_RETRY_MS, Math.max(1_000, requested ?? DEFAULT_RETRY_MS));
}

function regionFingerprint(region: Region, fingerprint: string): string {
  return createHashHex(JSON.stringify([region, fingerprint]));
}

function createHashHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isNotionRequest(input: string | URL): boolean {
  try {
    const url = new URL(input);
    return url.origin === NOTION_ORIGIN && (url.pathname === "/v1" || url.pathname.startsWith("/v1/"));
  } catch { return false; }
}

export type CredentialSession = {
  accessToken: string;
  refreshSucceeded: boolean;
  refresh: (signal: AbortSignal) => Promise<boolean>;
  fetcher: Fetcher;
};

export function createCredentialSession(
  initialAccessToken: string,
  rotate: (signal: AbortSignal) => Promise<string | null>,
  fetcher: Fetcher = fetch,
): CredentialSession {
  const session: CredentialSession = {
    accessToken: initialAccessToken,
    refreshSucceeded: false,
    refresh: async (signal) => {
      const replacement = await rotate(signal);
      if (!replacement) return false;
      session.accessToken = replacement;
      session.refreshSucceeded = true;
      return true;
    },
    fetcher: async (input, init = {}) => {
      if (!isNotionRequest(input)) throw new WorkerError("Notion request target is invalid", "invalid_config");
      const method = (init.method ?? "GET").toUpperCase();
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${session.accessToken}`);
      const response = await fetcher(input, { ...init, headers, redirect: "error" });
      if (response.status !== 401) return response;
      if (session.refreshSucceeded) return response;
      await response.body?.cancel().catch(() => undefined);
      const refreshed = await session.refresh(init.signal as AbortSignal);
      if (!refreshed || method !== "GET") return response;
      headers.set("Authorization", `Bearer ${session.accessToken}`);
      return await fetcher(input, { ...init, headers, redirect: "error" });
    },
  };
  return session;
}

function resultFor(row: ReturnType<typeof parseRow>, status: ReviewResponse["status"]): ReviewResponse {
  return {
    status,
    notices: [],
    ...(row?.invalidPacket ? { warnings: ["Some packet details could not be read, so the review may be less specific."] } : {}),
  };
}

export const setup = internalAction({
  args: { installationId: v.id("notionInstallations"), expectedGeneration: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const claim = await ctx.runMutation(internal.notion.claimSetup, { ...args, now: Date.now() });
    if (claim.result !== "claimed") return;
    const setup: SetupClaim = claim;
    const controller = AbortSignal.timeout(ACTION_DEADLINE_MS);
    try {
      const credentials = scopedCredentials(setup.credentialEnvelope, { workspaceId: setup.workspaceId, ownerId: setup.ownerId });
      const credentialSession = createCredentialSession(credentials.accessToken, async (refreshSignal) => {
        const claim = await ctx.runMutation(internal.notion.claimRefresh, {
          installationId: setup.installationId, expectedRevision: setup.credentialRevision, now: Date.now(),
        });
        if (claim.result !== "claimed") {
          await ctx.runMutation(internal.notion.failRefresh, { installationId: setup.installationId, expectedRevision: setup.credentialRevision, now: Date.now() });
          return null;
        }
        try {
          const current = scopedCredentials(claim.envelope, { workspaceId: setup.workspaceId, ownerId: setup.ownerId });
          const refreshed = await oauthApi().refresh(current.refreshToken, refreshSignal);
          const nextEnvelope = encryptCredentials(refreshed, { workspaceId: setup.workspaceId, ownerId: setup.ownerId }, requiredEnv("NOTION_CREDENTIAL_KEY"));
          const rotated = await ctx.runMutation(internal.notion.rotateCredentials, {
            installationId: setup.installationId, expectedRevision: setup.credentialRevision, nextEnvelope, now: Date.now(),
          });
          return rotated.result === "rotated" ? refreshed.accessToken : null;
        } catch {
          await ctx.runMutation(internal.notion.failRefresh, { installationId: setup.installationId, expectedRevision: setup.credentialRevision, now: Date.now() });
          return null;
        }
      });
      const api = oauthApi(credentialSession.fetcher);
      let binding: ListBinding;
      const preserved = persistedBinding(setup);
      if (setup.templatePageId) {
        binding = await api.discoverList(credentialSession.accessToken, setup.templatePageId, setup.region, controller);
      } else if (setup.databaseId || setup.dataSourceId || setup.properties) {
        if (!preserved) throw new WorkerError("Stored Notion list configuration is invalid", "invalid_config");
        binding = preserved;
        const config = configFor(binding, setup.region);
        await validateSelectedDataSource(new NotionRestClient(() => Promise.resolve(credentialSession.accessToken), credentialSession.fetcher), config, controller);
      } else {
        throw new WorkerError("Notion template page is unavailable", "invalid_config");
      }
      await ctx.runMutation(internal.notion.bindInstallation, {
        installationId: setup.installationId,
        expectedGeneration: setup.generation,
        binding,
        now: Date.now(),
      });
      const pageIds = await api.listUnboughtPageIds(credentialSession.accessToken, binding, controller);
      if (pageIds.length > MAX_SETUP_ROWS) throw new WorkerError("Notion shopping list exceeds the supported row limit", "invalid_config");
      const ready = await ctx.runMutation(internal.notion.ready, {
        installationId: setup.installationId,
        expectedGeneration: setup.generation,
        leaseId: setup.leaseId,
        pageIds,
        now: Date.now(),
      });
      if (!ready) await ctx.runMutation(internal.notion.finishSetup, {
        installationId: setup.installationId, expectedGeneration: setup.generation, leaseId: setup.leaseId, now: Date.now(),
      });
    } catch (error) {
      await ctx.runMutation(internal.notion.finishSetup, {
        installationId: setup.installationId,
        expectedGeneration: setup.generation,
        leaseId: setup.leaseId,
        now: Date.now(),
        errorCode: safeCode(error),
      });
    }
  },
});

export const run = internalAction({
  args: { installationId: v.id("notionInstallations") },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.runMutation(internal.notion.claimJob, { installationId: args.installationId, now: Date.now() });
    if (!job) return;
    const signal = AbortSignal.timeout(ACTION_DEADLINE_MS);
    let result: "success" | "retry" | "failed" = "failed";
    let errorCode: string | undefined;
    let retry: number | undefined;
    let refreshSucceeded = false;
    try {
      if (!job.binding) throw new WorkerError("Notion list binding is missing", "invalid_config");
      const scope = { workspaceId: job.workspaceId, ownerId: job.ownerId };
      const initial = scopedCredentials(job.credentialEnvelope, scope);
      const credentialSession = createCredentialSession(initial.accessToken, async (refreshSignal) => {
        const claim = await ctx.runMutation(internal.notion.claimRefresh, {
          installationId: job.installationId,
          expectedRevision: job.credentialRevision,
          now: Date.now(),
        });
        if (claim.result !== "claimed") {
          await ctx.runMutation(internal.notion.failRefresh, { installationId: job.installationId, expectedRevision: job.credentialRevision, now: Date.now() });
          return null;
        }
        try {
          const current = scopedCredentials(claim.envelope, scope);
          const refreshed = await oauthApi().refresh(current.refreshToken, refreshSignal);
          const nextEnvelope = encryptCredentials(refreshed, scope, requiredEnv("NOTION_CREDENTIAL_KEY"));
          const rotated = await ctx.runMutation(internal.notion.rotateCredentials, {
            installationId: job.installationId,
            expectedRevision: job.credentialRevision,
            nextEnvelope,
            now: Date.now(),
          });
          if (rotated.result !== "rotated") return null;
          refreshSucceeded = true;
          return refreshed.accessToken;
        } catch {
          await ctx.runMutation(internal.notion.failRefresh, { installationId: job.installationId, expectedRevision: job.credentialRevision, now: Date.now() });
          return null;
        }
      });
      const notion = new NotionRestClient(() => Promise.resolve(credentialSession.accessToken), credentialSession.fetcher);
      const binding = persistedBinding(job.binding);
      if (!binding) throw new WorkerError("Notion list binding is invalid", "invalid_config");
      const config = configFor(binding, job.region);
      validateConfig(config);
      const page = await notion.getPage(job.pageId, signal);
      assertSelectedDatabase(page, config);
      const row = parseRow(page, config);
      if (!row || row.bought || !row.item.name.trim()) {
        result = "success";
      } else {
        const fingerprint = regionFingerprint(job.region, row.fingerprint);
        const previous = await ctx.runQuery(internal.notion.getFingerprint, { installationId: job.installationId, pageId: job.pageId, region: job.region });
        if (previous === fingerprint) {
          result = "success";
        } else {
          const quota = await ctx.runMutation(internal.notion.takeReviewQuota, { installationId: job.installationId, now: Date.now() });
          if (!quota.allowed) {
            result = "retry";
            retry = quota.retryAt;
          } else {
            let review: ReviewResponse;
            if (row.invalidPacket || !canReviewItem(row.item)) {
              review = resultFor(row, "unable_to_review");
            } else {
              const mcp = new McpReviewClient(config.reviewMcpUrl, config.reviewConnectionKey, config.reviewToolName);
              try {
                await connectReviewClient(mcp, signal);
                review = await mcp.review(row.item, job.region, signal);
              } finally {
                await closeReviewClient(mcp);
              }
            }
            const leaseCurrent = await ctx.runQuery(internal.notion.leaseCurrent, {
              installationId: job.installationId,
              jobId: job.jobId,
              leaseId: job.leaseId,
              generation: job.generation,
              now: Date.now(),
            });
            if (!leaseCurrent) {
              result = "failed";
            } else {
              const fresh = await notion.getPage(job.pageId, signal);
              assertSelectedDatabase(fresh, config);
              const currentRow = parseRow(fresh, config);
              if (!currentRow || currentRow.bought || !currentRow.item.name.trim()) {
                result = "success";
              } else if (regionFingerprint(job.region, currentRow.fingerprint) !== fingerprint) {
                result = "retry";
                retry = Date.now() + 1_000;
              } else {
                const stillCurrent = await ctx.runQuery(internal.notion.leaseCurrent, {
                  installationId: job.installationId, jobId: job.jobId, leaseId: job.leaseId, generation: job.generation,
                  now: Date.now(),
                });
                if (!stillCurrent) {
                  result = "failed";
                } else {
                  const properties = buildWriteProperties(config, review, fingerprint, Date.now());
                  await notion.patchPage(job.pageId, properties, signal);
                  await ctx.runMutation(internal.notion.completeFingerprint, {
                    installationId: job.installationId,
                    jobId: job.jobId,
                    leaseId: job.leaseId,
                    generation: job.generation,
                  claimedRevision: job.claimedRevision,
                    fingerprint,
                    now: Date.now(),
                  });
                  result = "success";
                }
              }
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof WorkerError && error.code === "revoked") {
        if (refreshSucceeded) {
          result = "retry";
          retry = Date.now() + 1_000;
        } else if (error.message.includes("Notion access") && !error.message.includes("MCP") && !error.message.includes("Review")) {
          await ctx.runMutation(internal.notion.failRefresh, { installationId: job.installationId, expectedRevision: job.credentialRevision, now: Date.now() });
        }
      }
      if (result === "retry") {
        errorCode = "temporary";
      } else if (error instanceof WorkerError && error.code === "out_of_scope") {
        result = "success";
      } else if (error instanceof WorkerError && ["invalid_config", "missing_property"].includes(error.code)) {
        result = "failed";
        errorCode = safeCode(error);
      } else {
        result = "retry";
        retry = retryAt(error, Date.now());
        errorCode = safeCode(error);
      }
    }
    await ctx.runMutation(internal.notion.finishJob, {
      installationId: job.installationId,
      jobId: job.jobId,
      leaseId: job.leaseId,
      claimedRevision: job.claimedRevision,
      result,
      now: Date.now(),
      ...(retry === undefined ? {} : { retryAt: retry }),
      ...(errorCode === undefined ? {} : { errorCode }),
    });
  },
});

export const disconnect = internalAction({
  args: { installationId: v.id("notionInstallations") },
  handler: async (ctx, args): Promise<void> => {
    const claim = await ctx.runMutation(internal.notion.claimDisconnect, { installationId: args.installationId, now: Date.now() });
    if (!claim) return;
    let permissionRemoved = false;
    try {
      const credentials = scopedCredentials(claim.credentialEnvelope, { workspaceId: claim.workspaceId, ownerId: claim.ownerId });
      await oauthApi().revoke(credentials.accessToken, AbortSignal.timeout(ACTION_DEADLINE_MS));
      permissionRemoved = true;
    } catch {
      permissionRemoved = false;
    } finally {
      await ctx.runMutation(internal.notion.finishDisconnect, {
        installationId: args.installationId,
        leaseId: claim.leaseId,
        permissionRemoved,
        now: Date.now(),
      });
    }
  },
});
