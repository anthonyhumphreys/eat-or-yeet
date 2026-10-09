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
const checkResult = {
  contractVersion: "1" as const,
  status: "possible_match" as const,
  label: "Possible warning match",
  qualification: "A possible warning match needs review against the packet and official notice.",
  checkedAt: "2026-10-09T12:00:00.000Z",
  matchLevel: "possible" as const,
  submittedEvidence: { productName: "Milk", brand: null, barcode: null, batchCode: "LOT-42", lotCode: null, producer: null, farmCode: null, countryOfOrigin: null, establishmentNumber: null, approvalNumber: null, retailer: null, category: null, eggMark: null, dates: { useBy: "2026-10-09", bestBefore: null, productionDate: null } },
  checkedEvidence: { productName: "Milk", brand: null, barcode: null, batchCode: "LOT-42", lotCode: null, producer: null, farmCode: null, countryOfOrigin: null, establishmentNumber: null, approvalNumber: null, retailer: null, category: null, eggMark: null, dates: { useBy: "2026-10-09", bestBefore: null, productionDate: null } },
  enrichedFields: [],
  coverage,
  inconclusiveReason: null,
  warnings: [{
    warning: {
      slug: "milk-packet-recall",
      title: "Milk packet recall",
      region: "US" as const,
      summary: "Check the affected batch.",
      hazard: null,
      hazardKind: "allergen" as const,
      hazardLabel: "Allergen",
      authority: "US FDA",
      publishedAt: "2026-10-08T12:00:00.000Z",
      updatedAt: "2026-10-09T12:00:00.000Z",
      websiteUrl: "https://eatoryeet.app/incidents/milk-packet-recall",
      officialSource: { url: "https://www.fda.gov/example", label: "US FDA" },
    },
    level: "possible" as const,
    reasons: [{ type: "batch" as const, message: "The packet batch may be affected.", evidence: "LOT-42" }],
    affectedGroups: [{
      key: "group-1",
      association: "source_group" as const,
      targets: [{ type: "batch" as const, value: "LOT-42", matchType: "exact" as const, dateFrom: null, dateTo: null, notes: null }],
    }],
    affectedGroupCount: 1,
    affectedGroupsComplete: true,
    packetReviewRequired: true,
  }],
  matchCount: 1,
  matchesComplete: true,
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

async function connect(
  executor: (name: ToolName, args: unknown, context: { signal: AbortSignal; network: string; connection?: { id: string; dailyLimit: number } }) => Promise<unknown>,
  mode: "legacy" | { pin: string } = { pin: "2026-07-28" },
) {
  const handler = createNotionMcpTransport("trusted-network", { id: "notion-shopping", dailyLimit: 40 }, executor);
  const client = new Client({ name: "notion-test", version: "1.0.0" }, { versionNegotiation: { mode } });
  const transport = new StreamableHTTPClientTransport(new URL("https://mcp.test/mcp/notion"), {
    fetch: async (input, init) => handler.fetch(new Request(input, init)),
  });
  await client.connect(transport);
  handlers.push(async () => { await client.close(); await handler.close(); });
  return client;
}

afterEach(async () => Promise.all(handlers.splice(0).map((close) => close())));

describe("private Notion MCP server", () => {
  it("exposes the private shopping, packet-check and warning tools with qualified discovery", async () => {
    const executor = vi.fn(async (name: ToolName) => {
      if (name === "review_shopping_items") return shopping;
      if (name === "check_product") return checkResult;
      if (name === "search_warnings") return searchWarnings;
      return coverage;
    });
    const client = await connect(executor);
    const { tools } = await client.listTools();

    expect(tools.map(({ name }) => name)).toEqual(["review_shopping_items", "check_product", "search_warnings", "get_warning", "get_coverage"]);
    expect(tools.every(({ annotations }) => annotations?.readOnlyHint === true && annotations.destructiveHint === false)).toBe(true);
    expect(tools.find(({ name }) => name === "review_shopping_items")?.description).toContain("does not establish that food is safe");
    expect(tools.find(({ name }) => name === "review_shopping_items")?.description).toContain("packet facts are ignored");
    expect(tools.find(({ name }) => name === "search_warnings")?.description).toContain("discovery, not a product safety check");
    expect(tools.find(({ name }) => name === "check_product")?.description).toContain("must not be written into a shopping-list row");
    expect(tools.find(({ name }) => name === "check_product")?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });

    const result = await client.callTool({ name: "review_shopping_items", arguments: { region: "US", items: [{ id: "milk-1", name: "Milk" }] } });
    expect(result.structuredContent).toEqual(shopping);
    expect(executor).toHaveBeenCalledWith("review_shopping_items", { region: "US", items: [{ id: "milk-1", name: "Milk", bought: false }] }, expect.objectContaining({
      network: "trusted-network", connection: { id: "notion-shopping", dailyLimit: 40 }, signal: expect.any(AbortSignal),
    }));

    const packetCheck = await client.callTool({ name: "check_product", arguments: {
      region: "US",
      observation: { productName: "Milk", batchCode: "LOT-42", dates: { useBy: "2026-10-09" } },
    } });
    expect(packetCheck.structuredContent).toEqual(checkResult);
    expect(packetCheck.content).toEqual([{ type: "text", text: "Possible warning match\nA possible warning match needs review against the packet and official notice." }]);
    expect(packetCheck.structuredContent).toMatchObject({
      warnings: [{ packetReviewRequired: true, affectedGroups: [{ targets: [{ type: "batch", value: "LOT-42" }] }] }],
    });
    expect(executor).toHaveBeenCalledWith("check_product", expect.objectContaining({
      region: "US",
      observation: expect.objectContaining({ productName: "Milk", batchCode: "LOT-42", dates: { useBy: "2026-10-09", bestBefore: null, productionDate: null } }),
    }), expect.objectContaining({
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

  it("keeps quiet per-request handlers warning-free", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (let request = 0; request < 3; request += 1) {
        const handler = createNotionMcpTransport("trusted-network", { id: "notion-shopping", dailyLimit: 40 }, vi.fn(async () => shopping));
        await handler.close();
      }
      expect(warn).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it("serves the legacy initialize, tools/list, and tools/call flow", async () => {
    const executor = vi.fn(async () => coverage);
    const client = await connect(executor, "legacy");

    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name)).toEqual(["review_shopping_items", "check_product", "search_warnings", "get_warning", "get_coverage"]);
    const result = await client.callTool({ name: "get_coverage", arguments: { region: "US" } });
    expect(result.structuredContent).toEqual(coverage);
    expect(executor).toHaveBeenCalledTimes(1);
  });
});
