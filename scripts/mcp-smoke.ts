import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { PublicCheckResultSchema, PublicCoverageSchema, PublicSearchResultSchema } from "../src/lib/integrations/contracts";

const address = process.argv[2];
if (!address) throw new Error("Usage: pnpm test:mcp http://localhost:3100/mcp");
const url = new URL(address);
if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
  throw new Error("Use HTTPS or a local loopback test endpoint.");
}

for (const mode of [{ pin: "2026-07-28" }, "legacy"] as const) {
  const client = new Client({ name: "eat-or-yeet-http-smoke", version: "1" }, { versionNegotiation: { mode } });
  try {
    await client.connect(new StreamableHTTPClientTransport(url));
    const { tools } = await client.listTools();
    for (const name of ["check_product", "search_warnings", "get_warning", "get_coverage"]) {
      if (!tools.some((tool) => tool.name === name)) throw new Error(`Missing tool: ${name}`);
    }
    const coverage = PublicCoverageSchema.parse((await client.callTool({ name: "get_coverage", arguments: { region: "US" } })).structuredContent);
    const check = PublicCheckResultSchema.parse((await client.callTool({ name: "check_product", arguments: { region: "US", observation: { barcode: "044000061494" } } })).structuredContent);
    const search = PublicSearchResultSchema.parse((await client.callTool({ name: "search_warnings", arguments: { region: "US", pageSize: 1 } })).structuredContent);
    if (!coverage.healthy && check.status !== "inconclusive") throw new Error("Incomplete coverage must prevent reassurance.");
    console.info(JSON.stringify({ protocol: typeof mode === "string" ? mode : mode.pin, tools: tools.length,
      coverageHealthy: coverage.healthy, oreoStatus: check.status, warningCount: search.total }));
  } finally { await client.close(); }
}
