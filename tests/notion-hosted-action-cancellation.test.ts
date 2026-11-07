import { afterEach, describe, expect, it, vi } from "vitest";
import { run as runNotionJob } from "../backend/notionActions";
import type { ActionCtx } from "../backend/operations";
import type { Id } from "../backend/model";
import { encryptCredentials } from "../integrations/notion/hosted/crypto";
import { McpReviewClient } from "../integrations/notion/shopping-core";

const ORIGIN = "https://eat-or-yeet.example.test";
const CREDENTIAL_KEY = Buffer.alloc(32, 17).toString("base64");

function deferred<A = void>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("hosted Notion action cancellation", () => {
  it.each([
    { phase: "connect" as const, timeoutMs: 15_000, expectedEvents: ["connect", "close", "finish"] },
    { phase: "review" as const, timeoutMs: 60_000, expectedEvents: ["connect", "review", "close", "finish"] },
  ])("cleans up a hung MCP $phase before finishing the durable job", async ({ phase, timeoutMs, expectedEvents }) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
    vi.stubEnv("NOTION_REVIEW_CONNECTION_KEY", "review-connection-key");
    vi.stubEnv("NOTION_CREDENTIAL_KEY", CREDENTIAL_KEY);

    const scope = { workspaceId: "workspace-1", ownerId: "owner-1" };
    const credentialEnvelope = encryptCredentials({ accessToken: "notion-access", refreshToken: "notion-refresh" }, scope, CREDENTIAL_KEY);
    const binding = {
      templatePageId: "template-1",
      databaseId: "database-1",
      dataSourceId: "source-1",
      properties: {
        item: { id: "item", kind: "title" as const },
        relatedWarnings: { id: "warnings", kind: "rich_text" as const },
        reviewStatus: { id: "status", kind: "select" as const },
        reviewedAt: { id: "reviewed", kind: "date" as const },
        inputFingerprint: { id: "fingerprint", kind: "rich_text" as const },
      },
      statusLabels: { found: "Found", none: "None", unable: "Unable" },
    };
    const page = {
      id: "page-1",
      parent: { type: "data_source_id", data_source_id: binding.dataSourceId, database_id: binding.databaseId },
      properties: {
        Item: { id: "item", type: "title", title: [{ plain_text: "Milk" }] },
        Warnings: { id: "warnings", type: "rich_text", rich_text: [] },
        Status: { id: "status", type: "select", select: null },
        Reviewed: { id: "reviewed", type: "date", date: null },
        Fingerprint: { id: "fingerprint", type: "rich_text", rich_text: [] },
      },
    };
    const requests: Array<{ method: string; url: string }> = [];
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      requests.push({ method: init?.method ?? "GET", url: String(input) });
      return Response.json(page);
    });

    const events: string[] = [];
    const connectStarted = deferred();
    vi.spyOn(McpReviewClient.prototype, "connect").mockImplementation(async (signal?: AbortSignal) => {
      events.push("connect");
      connectStarted.resolve();
      if (phase === "connect") {
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
    });
    const reviewStarted = deferred();
    let reviewSignal: AbortSignal | undefined;
    vi.spyOn(McpReviewClient.prototype, "review").mockImplementation(async (_item, _region, signal) => {
      events.push("review");
      reviewSignal = signal;
      reviewStarted.resolve();
      return await new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    vi.spyOn(McpReviewClient.prototype, "close").mockImplementation(async () => {
      events.push("close");
    });

    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds: number) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Action deadline exceeded", "TimeoutError")), milliseconds);
      return controller.signal;
    });

    const job = {
      installationId: "installation-1" as Id<"notionInstallations">,
      jobId: "job-1" as Id<"notionJobs">,
      leaseId: "lease-1",
      claimedRevision: 3,
      generation: 4,
      credentialRevision: 2,
      credentialEnvelope,
      workspaceId: scope.workspaceId,
      ownerId: scope.ownerId,
      region: "UK" as const,
      pageId: page.id,
      binding,
    };
    const mutations: Array<{ name: string; args: unknown }> = [];
    const ctx = {
      runMutation: async (ref: { name: string }, args: unknown) => {
        mutations.push({ name: ref.name, args });
        if (ref.name === "notion.claimJob") return job;
        if (ref.name === "notion.takeReviewQuota") return { allowed: true, retryAt: 0 };
        if (ref.name === "notion.finishJob") events.push("finish");
        return undefined;
      },
      runQuery: async (ref: { name: string }) => ref.name === "notion.getFingerprint" ? null : true,
    } as unknown as ActionCtx;

    const execution = runNotionJob.handler(ctx, { installationId: job.installationId });
    await Promise.race([
      (phase === "connect" ? connectStarted : reviewStarted).promise,
      execution.then(() => { throw new Error(`The job finished before opening its MCP client: ${JSON.stringify(mutations)}`); }),
    ]);
    await vi.advanceTimersByTimeAsync(timeoutMs);
    await execution;

    expect(events).toEqual(expectedEvents);
    if (phase === "review") expect(reviewSignal?.aborted).toBe(true);
    expect(mutations.at(-1)?.name).toBe("notion.finishJob");
    expect(mutations.at(-1)?.args).toMatchObject({ result: "retry", errorCode: "temporary" });
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });
});
