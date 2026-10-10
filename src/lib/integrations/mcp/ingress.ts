import "server-only";

import { NextRequest } from "next/server";
import { trustedNetworkSubject } from "@/lib/security/anonymous";

function configuredOrigins(): string[] {
  const raw = [process.env.NEXT_PUBLIC_APP_URL, ...(process.env.MCP_ALLOWED_ORIGINS ?? "").split(",")];
  if (process.env.VERCEL_URL) raw.push(`https://${process.env.VERCEL_URL}`);
  return raw.filter((value): value is string => Boolean(value?.trim())).map((value) => {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
      throw new Error("MCP requires a configured HTTPS origin.");
    }
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("MCP origins must contain only an origin.");
    return url.origin;
  });
}

export function integrationIngress(request: Request): { network: string; origin: string | null } {
  const origins = configuredOrigins();
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const developmentLoopback = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const allowedHosts = origins.map((origin) => new URL(origin).host);
  if (!allowedHosts.includes(host) && !(developmentLoopback && host === url.host)) throw new IntegrationIngressError(403);
  const origin = request.headers.get("origin");
  if (origin && !origins.includes(origin) && !(developmentLoopback && origin === url.origin)) throw new IntegrationIngressError(403);
  const network = trustedNetworkSubject(new NextRequest(request.url, { headers: request.headers })) ?? "local-development";
  return { network, origin };
}

export class IntegrationIngressError extends Error {
  constructor(readonly status: number) { super("This origin or host is not allowed."); }
}
