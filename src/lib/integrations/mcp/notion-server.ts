import "server-only";

import { createMcpHandler, McpServer, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";
import {
  GetCoverageInputSchema,
  GetWarningInputSchema,
  PublicCoverageSchema,
  PublicSearchResultSchema,
  PublicWarningDetailsSchema,
  SearchWarningsInputSchema,
} from "@/lib/integrations/contracts";
import { validatePublicResponse } from "@/lib/integrations/serialize";
import { ReviewShoppingInputSchema, ReviewShoppingResultSchema } from "@/lib/integrations/shopping/contracts";
import { executeTool, redactedIntegrationToolError, type ToolContext, type ToolName } from "./services";
import type { McpConnection } from "./connection-auth";
import type { z } from "zod";

export const NOTION_MCP_TOOL_NAMES = ["review_shopping_items", "search_warnings", "get_warning", "get_coverage"] as const;
type NotionToolName = (typeof NOTION_MCP_TOOL_NAMES)[number];

const descriptions: Record<NotionToolName, string> = {
  review_shopping_items: "Review up to 20 explicitly supplied shopping items against published warnings for the explicitly selected UK or US region. These are related notices, not packet verdicts or category-wide recalls. No matching warning does not establish that food is safe.",
  search_warnings: "Search published food warnings for the explicitly selected UK or US region. Search is discovery, not a product safety check; no search results do not establish that food is safe.",
  get_warning: "Read a published warning by its public slug, including consumer advice and affected product groups. This describes a warning record, not a current product check.",
  get_coverage: "Read source coverage and refresh health for the explicitly selected UK or US region.",
};

type PrivateToolExecutor = (name: ToolName, args: unknown, context: ToolContext) => Promise<unknown>;

function annotations() {
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
}

function conciseText(name: NotionToolName, value: unknown): string {
  if (name === "review_shopping_items") {
    const result = ReviewShoppingResultSchema.parse(value);
    return [result.qualification, ...result.items.map((item) => {
      const related = `${item.total} related warning${item.total === 1 ? "" : "s"}`;
      const titles = item.relatedWarnings.slice(0, 2).map(({ warning }) => warning.title);
      return `${item.id}: ${item.status.replaceAll("_", " ")} (${related})${titles.length ? ` — ${titles.join("; ")}` : ""}`;
    })].join("\n");
  }
  if (name === "search_warnings") {
    const result = PublicSearchResultSchema.parse(value);
    const headlines = result.warnings.slice(0, 3).map((warning) => warning.title);
    const count = `${result.total} warning${result.total === 1 ? "" : "s"} found`;
    return [count, ...headlines, result.qualification].join("\n");
  }
  if (name === "get_warning") {
    const result = PublicWarningDetailsSchema.parse(value);
    return `${result.warning.title}\n${result.consumerAdvice}\n${result.affectedGroupCount} affected product group${result.affectedGroupCount === 1 ? "" : "s"}`;
  }
  const result = PublicCoverageSchema.parse(value);
  return `${result.healthy ? "Coverage is current" : "Coverage is incomplete or needs attention"} for ${result.region}. ${result.sources.length} required source${result.sources.length === 1 ? "" : "s"} reported.`;
}

function toolCallback<Name extends NotionToolName, Schema extends z.ZodType>(
  name: Name,
  inputSchema: Schema,
  outputSchema: z.ZodType,
  executor: PrivateToolExecutor,
  context: Omit<ToolContext, "signal"> & { connection: McpConnection },
) {
  return async (untrustedArgs: z.infer<Schema>, serverContext: ServerContext): Promise<CallToolResult> => {
    try {
      const args = inputSchema.parse(untrustedArgs);
      const output = validatePublicResponse(outputSchema, await executor(name, args, {
        ...context,
        signal: serverContext.mcpReq.signal,
      }));
      return { content: [{ type: "text", text: conciseText(name, output) }], structuredContent: output };
    } catch (error) {
      const safe = redactedIntegrationToolError(error);
      return { isError: true, content: [{ type: "text", text: safe.message }], _meta: { publicError: safe.metadata } };
    }
  };
}

export function createNotionMcpTransport(
  network: string,
  connection: McpConnection,
  executor: PrivateToolExecutor = executeTool,
) {
  const context = { network, connection };
  return createMcpHandler(() => {
    const server = new McpServer({ name: "eat-or-yeet-notion-shopping", version: "1.0.0" });
    server.registerTool("review_shopping_items", {
      title: "Review shopping items",
      description: descriptions.review_shopping_items,
      inputSchema: ReviewShoppingInputSchema,
      outputSchema: ReviewShoppingResultSchema,
      annotations: annotations(),
    }, toolCallback("review_shopping_items", ReviewShoppingInputSchema, ReviewShoppingResultSchema, executor, context));
    server.registerTool("search_warnings", {
      title: "Search food warnings",
      description: descriptions.search_warnings,
      inputSchema: SearchWarningsInputSchema,
      outputSchema: PublicSearchResultSchema,
      annotations: annotations(),
    }, toolCallback("search_warnings", SearchWarningsInputSchema, PublicSearchResultSchema, executor, context));
    server.registerTool("get_warning", {
      title: "Read a food warning",
      description: descriptions.get_warning,
      inputSchema: GetWarningInputSchema,
      outputSchema: PublicWarningDetailsSchema,
      annotations: annotations(),
    }, toolCallback("get_warning", GetWarningInputSchema, PublicWarningDetailsSchema, executor, context));
    server.registerTool("get_coverage", {
      title: "Check source coverage",
      description: descriptions.get_coverage,
      inputSchema: GetCoverageInputSchema,
      outputSchema: PublicCoverageSchema,
      annotations: annotations(),
    }, toolCallback("get_coverage", GetCoverageInputSchema, PublicCoverageSchema, executor, context));
    return server;
  }, {
    legacy: "stateless",
    responseMode: "json",
    maxRequestBodySize: 32 * 1024,
    maxSubscriptions: 0,
    keepAliveMs: 0,
    onerror: () => { /* Protocol input is intentionally excluded from logs. */ },
  });
}
