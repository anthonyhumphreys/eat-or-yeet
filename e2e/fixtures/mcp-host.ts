import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import type { JSHandle, Page } from "@playwright/test";

const appHtml = readFile(new URL("../../public/mcp-app/result-v1.html", import.meta.url), "utf8");
let bridgeBundle: Promise<string> | undefined;

async function getBridgeBundle(): Promise<string> {
  bridgeBundle ??= build({
    stdin: {
      contents: `
        import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
        window.mountMcpHost = async (frame, html, theme) => {
          const calls = [];
          const modelContexts = [];
          const pendingCalls = [];
          const bridge = new AppBridge(null, { name: "Eat or Yeet browser test host", version: "1.0.0" },
            { serverTools: {}, updateModelContext: { text: {}, structuredContent: {} } },
            { hostContext: { toolInfo: { tool: { name: "check_product", inputSchema: { type: "object" } } }, theme } });
          bridge.oncalltool = async (params) => new Promise((resolve) => {
            const call = { params, resolve };
            calls.push(params);
            pendingCalls.push(call);
          });
          bridge.onupdatemodelcontext = async (params) => {
            modelContexts.push(params);
            return {};
          };
          const transport = new PostMessageTransport(frame.contentWindow, frame.contentWindow);
          const connected = bridge.connect(transport);
          // Install the parent listener before loading the view, then finish
          // initialization after the view can answer ui/initialize.
          frame.srcdoc = html;
          await connected;
          return {
            bridge,
            calls,
            modelContexts,
            resolveCall(index, result) { pendingCalls[index].resolve(result); },
            sendInput(argumentsValue) { return bridge.sendToolInput({ arguments: argumentsValue }); },
            sendResult(result) { return bridge.sendToolResult(result); },
            sendCancelled(reason = "Test cancellation") { return bridge.sendToolCancelled({ reason }); },
            setTheme(themeValue) { bridge.setHostContext({ theme: themeValue }); },
          };
        };
      `,
      resolveDir: process.cwd(),
      sourcefile: "mcp-browser-host.ts",
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    write: false,
  }).then((result) => result.outputFiles[0]!.text);
  return bridgeBundle;
}

export type McpBrowserHost = {
  readCalls: () => Promise<Array<{ name: string; arguments?: Record<string, unknown> }>>;
  readModelContexts: () => Promise<Array<{ content?: Array<{ type: string; text?: string }> }>>;
  resolveCall: (index: number, result: unknown) => Promise<void>;
  sendInput: (argumentsValue: unknown) => Promise<void>;
  sendResult: (result: unknown) => Promise<void>;
  sendCancelled: (reason?: string) => Promise<void>;
  setTheme: (theme: "light" | "dark") => Promise<void>;
};

type BrowserHostObject = {
  calls: Array<{ name: string; arguments?: Record<string, unknown> }>;
  modelContexts: Array<{ content?: Array<{ type: string; text?: string }> }>;
  resolveCall: (index: number, result: unknown) => void;
  sendInput: (argumentsValue: unknown) => Promise<void>;
  sendResult: (result: unknown) => Promise<void>;
  sendCancelled: (reason?: string) => Promise<void>;
  setTheme: (theme: "light" | "dark") => void;
};

class BrowserMcpHost implements McpBrowserHost {
  constructor(private readonly handle: JSHandle<BrowserHostObject>) {}

  async readCalls(): Promise<Awaited<ReturnType<McpBrowserHost["readCalls"]>>> {
    return this.handle.evaluate((host) => host.calls);
  }
  async readModelContexts(): Promise<Awaited<ReturnType<McpBrowserHost["readModelContexts"]>>> {
    return this.handle.evaluate((host) => host.modelContexts);
  }
  async resolveCall(index: number, result: unknown): Promise<void> {
    await this.handle.evaluate((host, value) => host.resolveCall(value.index, value.result), { index, result });
  }
  async sendInput(argumentsValue: unknown): Promise<void> {
    await this.handle.evaluate((host, value) => host.sendInput(value), argumentsValue);
  }
  async sendResult(result: unknown): Promise<void> {
    await this.handle.evaluate((host, value) => host.sendResult(value), result);
  }
  async sendCancelled(reason?: string): Promise<void> {
    await this.handle.evaluate((host, value) => host.sendCancelled(value), reason);
  }
  async setTheme(theme: "light" | "dark"): Promise<void> {
    await this.handle.evaluate((host, value) => host.setTheme(value), theme);
  }
}

export async function mountMcpApp(page: Page, theme: "light" | "dark" = "light"): Promise<McpBrowserHost> {
  const [html, script] = await Promise.all([appHtml, getBridgeBundle()]);
  await page.setContent('<iframe title="MCP app test frame" style="display:block;width:100%;height:760px;border:0"></iframe>');
  await page.addScriptTag({ content: script });
  await page.evaluate(async ({ htmlContent, initialTheme }) => {
    const frame = document.querySelector("iframe");
    if (!frame) throw new Error("MCP app iframe was not created");
    // The host listener is connected before srcdoc creates the app document.
    const browserWindow = window as unknown as Window & {
      __mcpHost?: BrowserHostObject;
      mountMcpHost: (target: HTMLIFrameElement, html: string, theme: string) => Promise<BrowserHostObject>;
    };
    browserWindow.__mcpHost = await browserWindow.mountMcpHost(frame, htmlContent, initialTheme);
  }, { htmlContent: html, initialTheme: theme });
  await page.frameLocator("iframe").locator("#app").waitFor({ state: "attached" });
  const handle = await page.evaluateHandle(() => (window as unknown as Window & { __mcpHost: BrowserHostObject }).__mcpHost);
  return new BrowserMcpHost(handle as JSHandle<BrowserHostObject>);
}

export function checkResult(region: "UK" | "US", overrides: Record<string, unknown> = {}) {
  const checkedAt = "2026-10-09T12:00:00.000Z";
  const submittedEvidence = {
    productName: "Sample milk",
    brand: "Sample Dairy",
    barcode: null,
    batchCode: null,
    lotCode: null,
    producer: "Submitted producer",
    farmCode: null,
    countryOfOrigin: region === "US" ? "United States" : "United Kingdom",
    establishmentNumber: null,
    approvalNumber: null,
    retailer: null,
    category: null,
    eggMark: null,
    dates: { useBy: null, bestBefore: null, productionDate: "2026-10-01" },
  };
  const checkedEvidence = {
    ...submittedEvidence,
    productName: "Catalogued milk",
    producer: "Enriched producer",
    dates: { ...submittedEvidence.dates, productionDate: "2026-09-30" },
  };
  return {
    contractVersion: "1",
    status: "warning_match",
    label: `${region} warning match`,
    qualification: "Compare the listed codes with the package.",
    checkedAt,
    matchLevel: "confirmed",
    submittedEvidence,
    checkedEvidence,
    enrichedFields: ["productName", "producer", "dates"],
    coverage: {
      contractVersion: "1",
      region,
      healthy: true,
      checkedAt,
      coveredRegions: [region],
      sources: [{ id: region === "US" ? "fda" : "fsa", name: region === "US" ? "FDA" : "Food Standards Agency", region, lastSuccessfulAt: checkedAt, status: "healthy", scope: "Food alerts" }],
    },
    inconclusiveReason: null,
    warnings: [{
      warning: {
        slug: `${region.toLowerCase()}-sample-recall`,
        title: `${region} sample milk recall`,
        region,
        summary: "Review the marked packets.",
        hazard: "Possible Listeria",
        hazardKind: "pathogen",
        hazardLabel: "Pathogen",
        authority: region === "US" ? "FDA" : "Food Standards Agency",
        publishedAt: checkedAt,
        updatedAt: checkedAt,
        websiteUrl: `https://eatoryeet.app/incidents/${region.toLowerCase()}-sample-recall`,
        officialSource: { url: region === "US" ? "https://www.fda.gov/example" : "https://www.food.gov.uk/example", label: "Official notice" },
      },
      level: "confirmed",
      reasons: [{ type: "product", message: "Product name matches", evidence: "Sample milk" }],
      affectedGroups: [{
        key: "sample-packet-group",
        association: "source_group",
        targets: [
          { type: "product", value: "Sample milk", matchType: "exact", dateFrom: null, dateTo: null, notes: null },
          { type: "batch", value: "BATCH-123", matchType: "exact", dateFrom: null, dateTo: null, notes: "Printed beside the use-by date" },
        ],
      }],
      affectedGroupCount: 1,
      affectedGroupsComplete: true,
      packetReviewRequired: true,
    }],
    matchCount: 1,
    matchesComplete: true,
    ...overrides,
  };
}

export function toolResult(structuredContent: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: isError ? "The test tool failed." : "Completed test result." }], structuredContent, ...(isError ? { isError: true } : {}) };
}
