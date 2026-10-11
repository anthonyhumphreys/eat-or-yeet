import "server-only";
import { recordMcpOperation } from "@/lib/analytics/server";

import { getRegionCoverage, WarningSnapshotLimitError } from "@/db/queries";
import { checkProduct } from "@/lib/checks/service";
import { getWarningDetails, WarningDetailsCursorError } from "@/lib/incidents/details";
import { searchWarnings, WarningSearchCursorError } from "@/lib/incidents/search";
import { takeIntegrationRateLimits, type IntegrationRateLimitAction } from "@/lib/security/integration-rate-limit";
import { CheckProductInputSchema, GetCoverageInputSchema, GetWarningInputSchema, SearchWarningsInputSchema } from "../contracts";
import { ReviewShoppingInputSchema } from "../shopping/contracts";
import { reviewShoppingItems } from "../shopping/review";
import { PublicResponseTooLargeError, serializeCheckResult, serializeCoverage, serializeSearchResult } from "../serialize";

export type ToolName = "check_product" | "search_warnings" | "get_warning" | "get_coverage" | "review_shopping_items";
export type ToolContext = { signal: AbortSignal; network: string; connection?: { id: string; dailyLimit: number } };

export class IntegrationToolError extends Error {
  constructor(
    readonly code: "invalid_arguments" | "quota_exceeded" | "unavailable" | "restart_pagination" | "response_too_large" | "snapshot_limit" | "interrupted" | "not_found",
    message: string,
    readonly retryAfterSeconds?: number,
    readonly recoverable = false,
  ) { super(message); this.name = "IntegrationToolError"; }
}

const actions: Record<ToolName, IntegrationRateLimitAction> = {
  check_product: "mcp_check", search_warnings: "mcp_browse", get_warning: "mcp_browse", get_coverage: "mcp_coverage",
  review_shopping_items: "mcp_shopping",
};

/** Stops waiting on cancellation. Convex requests already sent may still finish. */
export async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) void work.catch(() => undefined);
  signal.throwIfAborted();
  let onAbort: () => void = () => undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("Interrupted"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

function parsedArguments(name: ToolName, args: unknown) {
  if (Buffer.byteLength(JSON.stringify(args) ?? "", "utf8") > 16 * 1024) {
    throw new IntegrationToolError("invalid_arguments", "Tool arguments exceed the 16 KiB limit.");
  }
  const schema = { check_product: CheckProductInputSchema, search_warnings: SearchWarningsInputSchema,
    get_warning: GetWarningInputSchema, get_coverage: GetCoverageInputSchema, review_shopping_items: ReviewShoppingInputSchema }[name];
  const parsed = schema.safeParse(args);
  if (!parsed.success) throw new IntegrationToolError("invalid_arguments", "Supply the required region and valid product or warning details. Dates must use YYYY-MM-DD.");
  return parsed.data;
}

/** Reads only public services; transport identity and budgets stay outside the checker. */
export async function executeTool(name: ToolName, args: unknown, context: ToolContext) {
  const startedAt = Date.now();
  let outcome: string = "unavailable";
  try {
    context.signal.throwIfAborted();
    const parsed = parsedArguments(name, args);
    if (name === "review_shopping_items" && !context.connection) {
      throw new IntegrationToolError("unavailable", "This tool requires an authenticated private connection.");
    }
    const units = name === "review_shopping_items" ? (parsed as ReturnType<typeof ReviewShoppingInputSchema.parse>).items.length : 1;
    const action = context.connection ? "mcp_shopping" : actions[name];
    const quota = context.connection
      ? takeIntegrationRateLimits(context.network, action, units, context.connection)
      : takeIntegrationRateLimits(context.network, actions[name]);
    const limits = await untilAborted(quota, context.signal);
    context.signal.throwIfAborted();
    const exhausted = limits.filter((limit) => !limit.allowed);
    if (exhausted.length) {
      const retry = Math.max(1, Math.ceil((Math.max(...exhausted.map((limit) => limit.resetAt.getTime())) - Date.now()) / 1000));
      throw new IntegrationToolError("quota_exceeded", "The integration budget is exhausted. Try again after the indicated delay, or use the website.", retry, true);
    }
    const value = await untilAborted((async () => {
      switch (name) {
        case "check_product": {
          const input = CheckProductInputSchema.parse(args);
          return serializeCheckResult(await checkProduct(input.observation, input.region, { signal: context.signal }));
        }
        case "search_warnings": {
          const input = SearchWarningsInputSchema.parse(args);
          return serializeSearchResult(await searchWarnings(input, { signal: context.signal }), input.region);
        }
        case "get_warning": {
          const result = await getWarningDetails(GetWarningInputSchema.parse(args));
          if (!result) throw new IntegrationToolError("not_found", "That public warning could not be found. Search again for its current reference.", undefined, true);
          return result;
        }
        case "get_coverage": {
          const { region } = GetCoverageInputSchema.parse(args);
          return serializeCoverage(await getRegionCoverage(region), region);
        }
        case "review_shopping_items":
          return reviewShoppingItems(ReviewShoppingInputSchema.parse(args), { signal: context.signal });
      }
    })(), context.signal);
    context.signal.throwIfAborted();
    outcome = "status" in value ? String(value.status) : "ok";
    return value;
  } catch (error) {
    let publicError: IntegrationToolError;
    if (context.signal.aborted) publicError = new IntegrationToolError("interrupted", "The request was interrupted. No completed check was returned.", undefined, true);
    else if (error instanceof IntegrationToolError) publicError = error;
    else if (error instanceof WarningSearchCursorError || error instanceof WarningDetailsCursorError) {
      publicError = new IntegrationToolError("restart_pagination", "The warning page expired or changed. Restart without a cursor.", undefined, true);
    } else if (error instanceof WarningSnapshotLimitError) {
      publicError = new IntegrationToolError("snapshot_limit", "A complete warning search exceeds the supported dataset limit. No partial results were returned.", undefined, true);
    } else if (error instanceof PublicResponseTooLargeError) {
      publicError = new IntegrationToolError("response_too_large", "The complete identifying details exceed the response limit. Open the warning on the website.");
    } else publicError = new IntegrationToolError("unavailable", "The warning service is unavailable. No completed check was returned.", undefined, true);
    outcome = publicError.code;
    throw publicError;
  } finally {
    recordMcpOperation(name, outcome, Date.now() - startedAt, Boolean(context.connection));
    if (process.env.NODE_ENV === "production") {
      console.info(JSON.stringify({ event: "mcp_operation", operation: name, latencyMs: Date.now() - startedAt, outcome }));
    }
  }
}

/** Sanitizes errors before they cross an integration protocol boundary. */
export function redactedIntegrationToolError(error: unknown) {
  if (error instanceof IntegrationToolError) {
    return {
      message: error.message,
      metadata: {
        code: error.code,
        ...(typeof error.retryAfterSeconds === "number" && Number.isFinite(error.retryAfterSeconds)
          ? { retryAfterSeconds: Math.max(0, error.retryAfterSeconds) } : {}),
        ...(typeof error.recoverable === "boolean" ? { recoverable: error.recoverable } : {}),
      },
    };
  }
  return { message: "This request could not be completed. Please try again later.", metadata: { code: "INTERNAL_ERROR", recoverable: true } };
}
