import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { MAX_APP_HTML_BYTES, MAX_APP_RESPONSE_BYTES } from "./app-limits";

export const MCP_APP_RESOURCE_URI = "ui://eat-or-yeet/result-v1.html";
const ui = { prefersBorder: true, domain: "https://eatoryeet.app",
  csp: { connectDomains: [], resourceDomains: [], frameDomains: [] } };

export function registerResultApp(server: McpServer) {
  registerAppResource(server, "Eat or Yeet result and evidence editor", MCP_APP_RESOURCE_URI,
    { description: "Qualified food-warning result, packet evidence editor and published warning details.", _meta: { ui } },
    async () => {
      const text = await readFile(join(process.cwd(), "public/mcp-app/result-v1.html"), "utf8");
      if (Buffer.byteLength(text) > MAX_APP_HTML_BYTES || Buffer.byteLength(JSON.stringify(text)) > MAX_APP_RESPONSE_BYTES - 4096) {
        throw new Error("The app resource exceeds its static budget.");
      }
      return { contents: [{ uri: MCP_APP_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text, _meta: { ui } }] };
    });
}
