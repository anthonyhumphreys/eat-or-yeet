import { authenticateMcpConnection } from "@/lib/integrations/mcp/connection-auth";
import { createMcpHttpHandler } from "@/lib/integrations/mcp/http";
import { createNotionMcpTransport } from "@/lib/integrations/mcp/notion-server";
import type { McpConnection } from "@/lib/integrations/mcp/connection-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const handle = createMcpHttpHandler({
  enabled: () => process.env.MCP_ENABLED === "true" && process.env.MCP_NOTION_ENABLED === "true",
  privatePreflight: true,
  authorize: async (request) => {
    const auth = authenticateMcpConnection(request);
    return auth.ok ? { ok: true, context: auth.connection } : { ok: false, status: auth.status };
  },
  createTransport: (network, context) => createNotionMcpTransport(network, context as McpConnection),
});

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = handle;
