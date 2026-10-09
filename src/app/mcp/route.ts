import { createMcpHttpHandler } from "@/lib/integrations/mcp/http";
import { createMcpTransport } from "@/lib/integrations/mcp/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const handle = createMcpHttpHandler({
  enabled: () => process.env.MCP_ENABLED === "true",
  createTransport: (network) => createMcpTransport(network),
});

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = handle;
