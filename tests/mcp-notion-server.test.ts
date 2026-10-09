import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createNotionMcpTransport } from "@/lib/integrations/mcp/notion-server";
import type { ToolName } from "@/lib/integrations/mcp/services";

const coverage = {
  contractVersion: "1" as const,
  region: "US" as const,
  healthy: true,
  checkedAt: "2026-10-09T12:00:00.000Z",
  coveredRegions: ["US" as const],
  sources: [{ id: "fda", name: "US FDA", region: "US" as const, lastSuccessfulAt: "2026-10-09T11:00:00.000Z", status: "healthy" as const, scope: "Packaged food warnings" }],
};
const shopping = {
  region: "US" as const,
  qualification: "Warning discovery does not establish that food is safe.",
  coverage,
  items: [{ id: "milk-1", status: "no_related_warnings" as const, qualification: "No related published warnings were found.", relatedWarnings: [], total: 0, nextAction: { tool: "none" as const } }],
};
const searchWarnings = {
  contractVersion: "1" as const,
  qualification: "Warning search is discovery, not a product check. No search results do not establish that food is safe.",
  asOf: "2026-10-09T12:00:00.000Z",
  coverage,
  warnings: [],
  total: 0,
  nextCursor: null,
  complete: true,
};
const handlers: Array<() => Promise<void>> = [];

async function connect(executor: (name: ToolName, args: unknown, context: { signal: AbortSignal; network: string; connection?: { id: string; dailyLimit: number } }) => Promise<unknown>) {
  const handler = createNotionMcpTransport("trusted-network", { id: "notion-shopping", dailyLimit: 40 }, executor);
  const client = new Client({ name: "notion-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("https://mcp.test/mcp/notion"), {
    fetch: async (input, init) => handler.fetch(new Request(input, init)),
  });
  await client.connect(transport);
  handlers.push(async () => { await client.close(); await handler.close(); });
  return client;
}

afterEach(async () => Promise.all(handlers.splice(0).map((close) => close())));

describe("private Notion MCP server", () => {
  it("exposes the four private shopping and warning tools with qualified discovery", async () => {
    const executor = vi.fn(async (name: ToolName) => {
      if (name === "review_shopping_items") return shopping;
      if (name === "search_warnings") return searchWarnings;
      return coverage;
    });
    const client = await connect(executor);
    const { tools } = await client.listTools();

    expect(tools.map(({ name }) => name)).toEqual(["review_shopping_items", "search_warnings", "get_warning", "get_coverage"]);
    expect(tools.every(({ annotations }) => annotations?.readOnlyHint === true && annotations.destructiveHint === false)).toBe(true);
    expect(tools.find(({ name }) => name === "review_shopping_items")?.description).toContain("category-only recall is not used");
    expect(tools.find(({ name }) => name === "search_warnings")?.description).toContain("discovery, not a product safety check");
    expect(tools.map(({ name }) => name)).not.toContain("check_product");

    const result = await client.callTool({ name: "review_shopping_items", arguments: { region: "US", items: [{ id: "milk-1", name: "Milk" }] } });
    expect(result.structuredContent).toEqual(shopping);
    expect(executor).toHaveBeenCalledWith("review_shopping_items", { region: "US", items: [{ id: "milk-1", name: "Milk", bought: false }] }, expect.objectContaining({
      network: "trusted-network", connection: { id: "notion-shopping", dailyLimit: 40 }, signal: expect.any(AbortSignal),
    }));

    const search = await client.callTool({ name: "search_warnings", arguments: { region: "US", query: "milk" } });
    expect(search.structuredContent).toEqual(searchWarnings);
    expect(search.content).toEqual([{ type: "text", text: "0 warnings found\nWarning search is discovery, not a product check. No search results do not establish that food is safe." }]);
    expect(executor).toHaveBeenCalledWith("search_warnings", expect.objectContaining({ region: "US", query: "milk", pageSize: 20 }), expect.objectContaining({
      network: "trusted-network", connection: { id: "notion-shopping", dailyLimit: 40 },
    }));
  });

  it("requires an explicit region before calling a service", async () => {
    const executor = vi.fn(async () => shopping);
    const client = await connect(executor);
    const result = await client.callTool({ name: "review_shopping_items", arguments: { items: [{ id: "milk-1", name: "Milk" }] } });
    expect(result.isError).toBe(true);
    expect(executor).not.toHaveBeenCalled();
  });
});
