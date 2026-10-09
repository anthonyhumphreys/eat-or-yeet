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
import type { z } from "zod";
import { MCP_APP_RESOURCE_URI, registerResultApp } from "./app-resource";

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

function conciseText(name: McpToolName, value: unknown): string {
  switch (name) {
    case "check_product": {
      const result = PublicCheckResultSchema.parse(value);
      const coverage = result.coverage.healthy ? "" : `Coverage is not current for ${result.coverage.region}.`;
      return [result.label, result.qualification, coverage].filter(Boolean).join("\n");
    }
    case "search_warnings": {
      const result = PublicSearchResultSchema.parse(value);
      const headlines = result.warnings.slice(0, 3).map((warning) => warning.title);
      const count = `${result.total} warning${result.total === 1 ? "" : "s"} found`;
      return [count, ...headlines, result.qualification].join("\n");
    }
    case "get_warning": {
      const result = PublicWarningDetailsSchema.parse(value);
      const count = `${result.affectedGroupCount} affected product group${result.affectedGroupCount === 1 ? "" : "s"}`;
      const pagination = result.nextCursor
        ? "More affected groups are available on the next page."
        : result.affectedGroupsComplete ? "" : "Some affected groups are omitted from this page.";
      return [result.warning.title, result.consumerAdvice, count, pagination].filter(Boolean).join("\n");
    }
    case "get_coverage": {
      const result = PublicCoverageSchema.parse(value);
      const status = result.healthy ? "Coverage is current" : "Coverage is incomplete or needs attention";
      return `${status} for ${result.region}. ${result.sources.length} required source${result.sources.length === 1 ? "" : "s"} reported.`;
    }
  }
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

      return {
        content: [{ type: "text", text: conciseText(name, output) }],
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

  return server;
}

export function createMcpTransport(network: string, executor: ToolExecutor = executeTool) {
  return createMcpHandler(
    () => createMcpServer(executor, network),
    {
      legacy: "stateless",
      responseMode: "json",
      maxRequestBodySize: 32 * 1024,
      maxSubscriptions: 0,
      keepAliveMs: 0,
      onerror: () => {
        // SDK diagnostics can include protocol data. Keep them out of logs.
      },
    },
  );
}
