import "server-only";

import {
  createMcpHandler,
  McpServer,
  type CallToolResult,
  type ServerContext,
} from "@modelcontextprotocol/server";

import {
  CheckProductInputSchema,
  GetCoverageInputSchema,
  GetWarningInputSchema,
  PublicCheckResultSchema,
  PublicCoverageSchema,
  PublicSearchResultSchema,
  PublicWarningDetailsSchema,
  SearchWarningsInputSchema,
} from "@/lib/integrations/contracts";
import { validatePublicResponse } from "@/lib/integrations/serialize";
import { executeTool, IntegrationToolError } from "./services";
import { z } from "zod";
import { MCP_APP_RESOURCE_URI, registerResultApp } from "./app-resource";
import { AppCaptureSchema } from "@/lib/analytics/contracts";
import { analyticsEnabled, scheduleEvent } from "@/lib/analytics/server";
import { takeRateLimits } from "@/lib/security/rate-limit";

export const MCP_TOOL_NAMES = [
  "check_product",
  "search_warnings",
  "get_warning",
  "get_coverage",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
export type ToolExecutor = (
  name: McpToolName,
  args: unknown,
  context: { signal: AbortSignal; network: string },
) => Promise<unknown>;

const descriptions: Record<McpToolName, string> = {
  check_product: "Compare explicitly supplied UK or US product evidence with published food warnings. A barcode alone is accepted. A no-match result does not establish that food is safe.",
  search_warnings: "Search published food warnings for the explicitly selected UK or US region. Search results are not product safety checks.",
  get_warning: "Read a published warning by its public slug, including consumer advice and affected product groups. This describes a warning record, not a current product check.",
  get_coverage: "Read source coverage and refresh health for the explicitly selected UK or US region.",
};

function toolAnnotations(name: McpToolName) {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: name === "check_product",
  } as const;
}

type PublicIntegrationError = Error & {
  code: string;
  retryAfterSeconds?: number;
  recoverable?: boolean;
};

function isPublicIntegrationError(error: unknown): error is PublicIntegrationError {
  return error instanceof IntegrationToolError;
}

function errorResult(error: unknown): CallToolResult {
  if (isPublicIntegrationError(error)) {
    const metadata: Record<string, string | number | boolean> = {
      code: error.code,
    };
    if (typeof error.retryAfterSeconds === "number" && Number.isFinite(error.retryAfterSeconds)) {
      metadata.retryAfterSeconds = Math.max(0, error.retryAfterSeconds);
    }
    if (typeof error.recoverable === "boolean") metadata.recoverable = error.recoverable;

    return {
      isError: true,
      content: [{ type: "text", text: error.message }],
      _meta: { publicError: metadata },
    };
  }

  // Unknown exceptions may contain identifiers, evidence, or provider bodies.
  return {
    isError: true,
    content: [{ type: "text", text: "This request could not be completed. Please try again later." }],
    _meta: { publicError: { code: "INTERNAL_ERROR", recoverable: true } },
  };
}

function toolCallback<Name extends McpToolName, InputSchema extends z.ZodType>(
  name: Name,
  inputSchema: InputSchema,
  outputSchema: z.ZodType,
  executor: ToolExecutor,
  network: string,
): (args: z.infer<InputSchema>, context: ServerContext) => Promise<CallToolResult> {
  return async (untrustedArgs, context) => {
    try {
      // The SDK validates registered schemas before this callback. Parse once
      // more here to ensure defaults and strict nested keys cross the executor
      // boundary in the same way in SDK and direct unit-test calls.
      const args = inputSchema.parse(untrustedArgs);
      const output = validatePublicResponse(outputSchema, await executor(name, args, {
        signal: context.mcpReq.signal,
        network,
      }));

      // Some hosts only forward text to the model. Mirror the validated public
      // result so warning links, cursors, restrictions and coverage stay usable.
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      return errorResult(error);
    }
  };
}

export function createMcpServer(executor: ToolExecutor, network: string): McpServer {
  const server = new McpServer({ name: "eat-or-yeet", version: "1.0.0" }, {
    instructions: "Ask for an explicit UK or US region before checking. Use facts supplied by the user; leave unknown packet fields empty. A barcode alone can start a check. No matching warning is not a safety guarantee. Search is discovery, not a product verdict. Explain incomplete coverage and unresolved packet restrictions. These tools cannot publish shares or monitor products.",
  });
  registerResultApp(server);

  server.registerTool("check_product", {
    title: "Check a product",
    description: descriptions.check_product,
    inputSchema: CheckProductInputSchema,
    outputSchema: PublicCheckResultSchema,
    annotations: toolAnnotations("check_product"),
    _meta: { securitySchemes: [{ type: "noauth" }], ui: { resourceUri: MCP_APP_RESOURCE_URI, visibility: ["model", "app"] } },
  }, toolCallback("check_product", CheckProductInputSchema, PublicCheckResultSchema, executor, network));

  server.registerTool("search_warnings", {
    title: "Search food warnings",
    description: descriptions.search_warnings,
    inputSchema: SearchWarningsInputSchema,
    outputSchema: PublicSearchResultSchema,
    annotations: toolAnnotations("search_warnings"),
    _meta: { securitySchemes: [{ type: "noauth" }], ui: { visibility: ["model", "app"] } },
  }, toolCallback("search_warnings", SearchWarningsInputSchema, PublicSearchResultSchema, executor, network));

  server.registerTool("get_warning", {
    title: "Read a food warning",
    description: descriptions.get_warning,
    inputSchema: GetWarningInputSchema,
    outputSchema: PublicWarningDetailsSchema,
    annotations: toolAnnotations("get_warning"),
    _meta: { securitySchemes: [{ type: "noauth" }], ui: { resourceUri: MCP_APP_RESOURCE_URI, visibility: ["model", "app"] } },
  }, toolCallback("get_warning", GetWarningInputSchema, PublicWarningDetailsSchema, executor, network));

  server.registerTool("get_coverage", {
    title: "Check source coverage",
    description: descriptions.get_coverage,
    inputSchema: GetCoverageInputSchema,
    outputSchema: PublicCoverageSchema,
    annotations: toolAnnotations("get_coverage"),
    _meta: { securitySchemes: [{ type: "noauth" }], ui: { visibility: ["model", "app"] } },
  }, toolCallback("get_coverage", GetCoverageInputSchema, PublicCoverageSchema, executor, network));

  server.registerTool("record_app_event", {
    title: "Record consented app usage", description: "Only for the embedded app after the person chooses Allow analytics. Accepts no product, conversation or identity fields.",
    inputSchema: AppCaptureSchema, outputSchema: z.object({ recorded: z.boolean() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    _meta: { securitySchemes: [{ type: "noauth" }], ui: { visibility: ["app"] } },
  }, async (args) => {
    let recorded = false;
    if (analyticsEnabled()) try {
      const [limit] = await takeRateLimits([{ subject: network, scope: "network" }], "analytics");
      if (limit?.allowed) {
        scheduleEvent(args.event, { source: "embedded_app", host: args.host, ...(args.tool ? { tool: args.tool } : {}) });
        recorded = true;
      }
    } catch { /* Usage reporting cannot affect checker availability. */ }
    return { content: [{ type: "text", text: JSON.stringify({ recorded }) }], structuredContent: { recorded } };
  });

  return server;
}

export function createMcpTransport(network: string, executor: ToolExecutor = executeTool) {
  return createMcpHandler(
    () => createMcpServer(executor, network),
    {
      legacy: "stateless",
      // Tools emit no mid-call notifications, so auto returns JSON without
      // the SDK's per-handler warning about deliberately dropping them.
      responseMode: "auto",
      maxRequestBodySize: 32 * 1024,
      maxSubscriptions: 0,
      keepAliveMs: 0,
      onerror: () => {
        // SDK diagnostics can include protocol data. Keep them out of logs.
      },
    },
  );
}
