import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  PublicCheckResultSchema,
  PublicCoverageSchema,
  PublicSearchResultSchema,
  PublicWarningDetailsSchema,
} from "../src/lib/integrations/contracts";
import { readResponseText } from "../src/lib/http/bounded-response";
import { MAX_APP_RESPONSE_BYTES } from "../src/lib/integrations/mcp/app-limits";

const APP_RESOURCE_URI = "ui://eat-or-yeet/result-v1.html";
const TOOL_NAMES = ["check_product", "search_warnings", "get_warning", "get_coverage"] as const;
const PROTOCOLS = [
  { label: "2026-07-28", mode: { pin: "2026-07-28" } },
  { label: "legacy", mode: "legacy" },
] as const;

const address = process.argv[2];
if (!address) throw new Error("Usage: pnpm test:mcp http://localhost:3100/mcp");
const url = new URL(address);
if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
  throw new Error("Use HTTPS or a local loopback test endpoint.");
}
if (
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.hostname === "eatoryeet.app" ||
  url.hostname.endsWith(".eatoryeet.app")
) {
  throw new Error("Use a credential-free local or controlled test endpoint while production MCP is disabled.");
}

type ExchangeMeasurement = {
  status: number;
  elapsedMs: number;
  requestBytes: number;
  responseBytes: number;
  contentEncoding: string | null;
};

async function runProtocol(label: string, mode: (typeof PROTOCOLS)[number]["mode"]): Promise<void> {
  const client = new Client(
    { name: "eat-or-yeet-http-smoke", version: "1" },
    { versionNegotiation: { mode } },
  );
  const exchanges: ExchangeMeasurement[] = [];

  const measuredFetch: typeof fetch = async (input, init) => {
    const started = performance.now();
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = AbortSignal.any([
      ...(requestSignal ? [requestSignal] : []),
      AbortSignal.timeout(20_000),
    ]);
    const response = await fetch(input, { ...init, signal, redirect: "error" });
    const text = await readResponseText(response.clone(), MAX_APP_RESPONSE_BYTES);
    exchanges.push({
      status: response.status,
      elapsedMs: Math.round(performance.now() - started),
      requestBytes: typeof init?.body === "string" ? Buffer.byteLength(init.body) : 0,
      responseBytes: Buffer.byteLength(text),
      contentEncoding: response.headers.get("content-encoding"),
    });
    return response;
  };

  try {
    await client.connect(new StreamableHTTPClientTransport(url, { fetch: measuredFetch }));
    const { tools } = await client.listTools();
    for (const name of TOOL_NAMES) {
      if (!tools.some((tool) => tool.name === name)) {
        throw new Error(`Missing tool: ${name}`);
      }
    }

    const coverageResult = await client.callTool({
      name: "get_coverage",
      arguments: { region: "US" },
    });
    const coverage = PublicCoverageSchema.parse(coverageResult.structuredContent);
    const checkResult = await client.callTool({
      name: "check_product",
      arguments: { region: "US", observation: { barcode: "044000061494" } },
    });
    const check = PublicCheckResultSchema.parse(checkResult.structuredContent);
    const searchResult = await client.callTool({
      name: "search_warnings",
      arguments: { region: "US", pageSize: 1 },
    });
    const search = PublicSearchResultSchema.parse(searchResult.structuredContent);
    if (!coverage.healthy && check.status !== "inconclusive") {
      throw new Error("Incomplete coverage must prevent reassurance.");
    }

    let warningDetailStatus: "checked" | "skipped-no-search-results";
    if (search.warnings[0]) {
      const detailResult = await client.callTool({
        name: "get_warning",
        arguments: { slug: search.warnings[0].slug, pageSize: 1 },
      });
      PublicWarningDetailsSchema.parse(detailResult.structuredContent);
      warningDetailStatus = "checked";
    } else {
      warningDetailStatus = "skipped-no-search-results";
    }

    const appResourceUri = (
      tools.find((tool) => tool.name === "check_product")?._meta?.ui as
        | { resourceUri?: unknown }
        | undefined
    )?.resourceUri;
    let appHtmlBytes: number | undefined;
    if (appResourceUri !== undefined) {
      if (appResourceUri !== APP_RESOURCE_URI) {
        throw new Error("Unexpected MCP App resource URI.");
      }
      const resource = await client.readResource({ uri: appResourceUri });
      const content = resource.contents[0];
      if (
        !content ||
        content.uri !== APP_RESOURCE_URI ||
        content.mimeType !== "text/html;profile=mcp-app" ||
        !("text" in content)
      ) {
        throw new Error("Invalid MCP App resource.");
      }
      appHtmlBytes = Buffer.byteLength(content.text);
    }
    console.info(JSON.stringify({
      protocol: label,
      tools: tools.length,
      coverageHealthy: coverage.healthy,
      oreoStatus: check.status,
      warningCount: search.total,
      warningDetailStatus,
      appHtmlBytes,
      exchanges,
    }));
  } finally {
    await client.close();
  }
}

async function smoke(): Promise<void> {
  for (const protocol of PROTOCOLS) {
    await runProtocol(protocol.label, protocol.mode);
  }
}

await smoke().catch(() => {
  // Provider and SDK errors can contain response bodies; keep the probe redacted.
  console.error("MCP smoke failed. Check the controlled deployment, protocol and coverage; no response body was logged.");
  process.exitCode = 1;
});
