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
import { AgentObservationSchema, type PublicSearchResult, type PublicWarningDetails } from "@/lib/integrations/contracts";

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
  it("rejects telemetry without consent or with private fields, and never invokes food tools", async () => {
    const executor = executorFor();
    const { client } = await connect(executor);
    for (const args of [
      { consent: false, host: "chatgpt", event: "app_opened" },
      { consent: true, host: "chatgpt", event: "app_opened", barcode: "private" },
    ]) {
      const result = await client.callTool({ name: "record_app_event", arguments: args });
      expect(result.isError).toBe(true);
    }
    const result = await client.callTool({ name: "record_app_event", arguments: { consent: true, host: "chatgpt", event: "app_opened" } });
    expect(result.structuredContent).toEqual({ recorded: false });
    expect(executor).not.toHaveBeenCalled();
  });
  it("creates per-request transports without SDK warning noise", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (let request = 0; request < 3; request += 1) {
        const handler = createMcpTransport("test-network", executorFor());
        await handler.close();
      }
      expect(warn).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
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
      "record_app_event",
    ]);
    expect(tools.filter(({ name }) => name !== "record_app_event").map(({ annotations }) => annotations)).toEqual([
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ]);
    expect(tools.every((tool) => tool.outputSchema)).toBe(true);
    expect(tools.find(({ name }) => name === "record_app_event")?._meta).toMatchObject({ ui: { visibility: ["app"] } });

    const result = await client.callTool({ name: "get_coverage", arguments: { region: "US" } });
    expect(result.structuredContent).toEqual(coverage);
    expect(result.content).toEqual([{
      type: "text",
      text: JSON.stringify(coverage),
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
    expect(tools).toHaveLength(5);
    const result = await client.callTool({ name: "get_coverage", arguments: { region: "US" } });
    expect(result.structuredContent).toEqual(coverage);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it.each(["legacy", "modern"] as const)("keeps search and packet evidence usable by a text-only %s host", async (mode) => {
    const warnings = Array.from({ length: 4 }, (_, index) => ({
      slug: `milk-warning-${index + 1}`,
      title: `Milk warning ${index + 1}`,
      region: "US" as const,
      summary: "Compare the packet with the official notice.",
      hazard: null,
      hazardKind: "allergen" as const,
      hazardLabel: "Allergen",
      authority: "US FDA",
      publishedAt: "2026-10-08T12:00:00.000Z",
      updatedAt: "2026-10-09T12:00:00.000Z",
      websiteUrl: `https://eatoryeet.app/incidents/milk-warning-${index + 1}`,
      officialSource: { url: `https://www.fda.gov/notice/${index + 1}`, label: "US FDA" },
    }));
    const search: PublicSearchResult = {
      contractVersion: "1", qualification: "Search is discovery, not a product verdict.",
      asOf: "2026-10-09T12:00:00.000Z", coverage, warnings,
      total: 12, nextCursor: "search-next-page", complete: false,
    };
    const details: PublicWarningDetails = {
      contractVersion: "1", warning: warnings[0], consumerAdvice: "Do not eat the affected batch.",
      affectedGroups: [{ key: "group-1", association: "source_group", targets: [{
        type: "batch", value: "LOT-42", matchType: "exact", dateFrom: null, dateTo: null, notes: null,
      }] }],
      affectedGroupCount: 3, affectedGroupsComplete: false, nextCursor: "groups-next-page",
    };
    const evidence = AgentObservationSchema.parse({ productName: "Milk", batchCode: "LOT-42" });
    const check = {
      contractVersion: "1", status: "possible_match", label: "Possible warning match",
      qualification: "Review the packet and official notice. This is not a safety guarantee.",
      checkedAt: "2026-10-09T12:00:00.000Z", matchLevel: "possible",
      submittedEvidence: evidence, checkedEvidence: evidence, enrichedFields: [], coverage,
      inconclusiveReason: null,
      warnings: [{ warning: warnings[0], level: "possible", reasons: [{ type: "batch", message: "Compare the batch.", evidence: "LOT-42" }],
        affectedGroups: details.affectedGroups, affectedGroupCount: 3, affectedGroupsComplete: false, packetReviewRequired: true }],
      matchCount: 1, matchesComplete: false,
    };
    const executor = executorFor({ search_warnings: search, get_warning: details, check_product: check });
    const { client } = await connect(executor, mode === "legacy" ? "legacy" : { pin: "2026-07-28" });

    // Deliberately ignore structuredContent, as the observed Grok Bot host does.
    const searchResult = await client.callTool({ name: "search_warnings", arguments: { region: "US", query: "milk" } });
    const searchText = searchResult.content[0];
    if (searchText.type !== "text") throw new Error("Missing text fallback");
    const fromText = JSON.parse(searchText.text) as PublicSearchResult;
    expect(fromText).toEqual(search);
    expect(fromText.warnings[3].officialSource.url).toBe("https://www.fda.gov/notice/4");
    expect(fromText.nextCursor).toBe("search-next-page");
    const detailResult = await client.callTool({ name: "get_warning", arguments: { slug: fromText.warnings[0].slug } });
    const detailText = detailResult.content[0];
    if (detailText.type !== "text") throw new Error("Missing detail fallback");
    expect(JSON.parse(detailText.text)).toEqual(details);
    expect(executor).toHaveBeenCalledWith("get_warning", expect.objectContaining({ slug: "milk-warning-1" }), expect.anything());

    const checkResult = await client.callTool({ name: "check_product", arguments: { region: "US", observation: evidence } });
    const checkText = checkResult.content[0];
    if (checkText.type !== "text") throw new Error("Missing packet fallback");
    expect(JSON.parse(checkText.text)).toEqual(check);
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
