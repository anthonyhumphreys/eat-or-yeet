import { createMcpHttpHandler } from "@/lib/integrations/mcp/http";
import { createMcpTransport } from "@/lib/integrations/mcp/server";
import { MCP_APP_RESOURCE_URI } from "@/lib/integrations/mcp/app-resource";
import { MAX_APP_RESPONSE_BYTES } from "@/lib/integrations/mcp/app-limits";

export const runtime = "nodejs";
export const maxDuration = 30;

const handle = createMcpHttpHandler({
  enabled: () => process.env.MCP_ENABLED === "true",
  createTransport: (network) => createMcpTransport(network),
  responseLimit: (body) => {
    const envelope = body as { method?: unknown; params?: { uri?: unknown } } | null;
    return envelope?.method === "resources/read" && envelope.params?.uri === MCP_APP_RESOURCE_URI
      ? MAX_APP_RESPONSE_BYTES : 256 * 1024;
  },
});

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = handle;
