import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import {
  createMcpTransport,
  type McpToolName,
  type ToolExecutor,
} from "@/lib/integrations/mcp/server";
import { IntegrationToolError } from "@/lib/integrations/mcp/services";
import { MCP_APP_RESOURCE_URI } from "@/lib/integrations/mcp/app-resource";

const coverage = {
  contractVersion: "1" as const,
  region: "US" as const,
  healthy: true,
  checkedAt: "2026-10-09T12:00:00.000Z",
  coveredRegions: ["US" as const],
  sources: [{
    id: "fda",
    name: "US FDA",
    region: "US" as const,
    lastSuccessfulAt: "2026-10-09T11:00:00.000Z",
    status: "healthy" as const,
    scope: "Packaged food warnings",
  }],
};

const handlers: Array<() => Promise<void>> = [];

async function connect(
  executor: ToolExecutor,
  mode: "legacy" | { pin: string } = { pin: "2026-07-28" },
) {
  const handler = createMcpTransport("test-network", executor);
  const client = new Client(
    { name: "eat-or-yeet-test", version: "1.0.0" },
    { versionNegotiation: { mode } },
  );
  const transport = new StreamableHTTPClientTransport(new URL("https://mcp.test/mcp"), {
    fetch: async (input, init) => handler.fetch(new Request(input, init)),
  });
  await client.connect(transport);
  handlers.push(async () => {
    await client.close();
    await handler.close();
  });
  return { client, handler };
}

afterEach(async () => {
  await Promise.all(handlers.splice(0).map((close) => close()));
});

function executorFor(
  outputs: Partial<Record<McpToolName, unknown>> = { get_coverage: coverage },
): ToolExecutor {
  return vi.fn(async (name: McpToolName) => outputs[name]);
}

describe("MCP server transport", () => {
  it("serves the inline app with explicit CSP and no data-service calls", async () => {
    const executor = executorFor();
    const { client } = await connect(executor);
    const { tools } = await client.listTools();
    expect(tools.filter((tool) => (tool._meta?.ui as { resourceUri?: string })?.resourceUri)
      .map((tool) => tool.name)).toEqual(["check_product", "get_warning"]);
    const resource = await client.readResource({ uri: MCP_APP_RESOURCE_URI });
    const content = resource.contents[0];
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content._meta?.ui).toMatchObject({ domain: "https://eatoryeet.app", csp: { connectDomains: [], resourceDomains: [] } });
    expect("text" in content && content.text).toContain("Content-Security-Policy");
    expect(executor).not.toHaveBeenCalled();
  });
  it("serves modern discovery, strict tool schemas, annotations, and structured output", async () => {
    const executor = executorFor();
    const { client } = await connect(executor);

    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name)).toEqual([
      "check_product",
      "search_warnings",
      "get_warning",
      "get_coverage",
    ]);
    expect(tools.map(({ annotations }) => annotations)).toEqual([
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ]);
    expect(tools.every((tool) => tool.outputSchema)).toBe(true);

    const result = await client.callTool({ name: "get_coverage", arguments: { region: "US" } });
    expect(result.structuredContent).toEqual(coverage);
    expect(result.content).toEqual([{
      type: "text",
      text: "Coverage is current for US. 1 required source reported.",
    }]);
    expect(executor).toHaveBeenCalledWith("get_coverage", { region: "US" }, expect.objectContaining({
      network: "test-network",
      signal: expect.any(AbortSignal),
    }));
  });

  it("serves the 2025 initialize, tools/list, and tools/call flow statelessly", async () => {
    const executor = executorFor();
    const { client } = await connect(executor, "legacy");

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(4);
    const result = await client.callTool({ name: "get_coverage", arguments: { region: "US" } });
    expect(result.structuredContent).toEqual(coverage);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown nested fields before invoking the executor", async () => {
    const executor = executorFor();
    const { client } = await connect(executor);

    const result = await client.callTool({
      name: "check_product",
      arguments: {
        region: "US",
        observation: { brand: "Example", dates: { useBy: null, forged: true } },
      },
    });
    expect(result.isError).toBe(true);
    expect(executor).not.toHaveBeenCalled();
  });

  it("returns only declared public error metadata for executor failures", async () => {
    const executor: ToolExecutor = vi.fn(async () => {
      throw new IntegrationToolError("quota_exceeded", "Too many requests", 12, true);
    });
    const { client } = await connect(executor);

    const result = await client.callTool({ name: "get_coverage", arguments: { region: "US" } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "Too many requests" }]);
    expect(result._meta).toMatchObject({
      publicError: { code: "quota_exceeded", retryAfterSeconds: 12, recoverable: true },
    });
  });

  it("does not expose invalid outputs or exception details", async () => {
    const executor = executorFor({ get_coverage: { region: "US", secret: "private" } });
    const { client } = await connect(executor);

    const result = await client.callTool({ name: "get_coverage", arguments: { region: "US" } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{
      type: "text",
      text: "This request could not be completed. Please try again later.",
    }]);
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it.each(["GET", "DELETE"] as const)("answers %s with 405 in stateless legacy mode", async (method) => {
    const handler = createMcpTransport("test-network", executorFor());
    const response = await handler.fetch(new Request("https://mcp.test/mcp", { method }));

    expect(response.status).toBe(405);
    await handler.close();
  });
});
