import "server-only";

import { fetchMutation, fetchQuery } from "convex/nextjs";
import { cookies } from "next/headers";

import { api } from "@convex/_generated/api";
import { NotionOAuthApi } from "../../../integrations/notion/managed/notion-api.ts";
import { getNotionInstallationOrigin, getNotionSetupOrigin } from "./notion-installation";
import { captureNotionWebhookVerification, handleNotionRequest, notionCookieNames, notionCsrf, notionHash, type NotionHttpDependencies } from "./notion-http";

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error("Notion installation is not configured");
  return value;
}
export function notionHttpDependencies(): NotionHttpDependencies | null {
  const origin = getNotionSetupOrigin();
  if (!origin) return null;
  const secret = required("CONVEX_SERVER_SECRET");
  const url = required("NEXT_PUBLIC_CONVEX_URL");
  return {
    origin,
    encryptionKey: required("NOTION_CREDENTIAL_KEY"),
    csrfSecret: secret,
    webhookToken: required("NOTION_WEBHOOK_VERIFICATION_TOKEN"),
    integrationId: required("NOTION_INTEGRATION_ID"),
    subscriptionId: required("NOTION_SUBSCRIPTION_ID"),
    oauth: new NotionOAuthApi(required("NOTION_CLIENT_ID"), required("NOTION_CLIENT_SECRET"), `${origin}/api/notion/callback`),
    backend: {
      beginOAuth: (args) => fetchMutation(api.notion.beginOAuth, { secret, ...args }, { url }),
      consumeOAuth: (args) => fetchMutation(api.notion.consumeOAuth, { secret, ...args }, { url }),
      authorize: (args) => fetchMutation(api.notion.authorize, { secret, ...args }, { url }),
      createSession: (args) => fetchMutation(api.notion.createSession, { secret, ...args }, { url }),
      management: (args) => fetchQuery(api.notion.management, { secret, ...args }, { url }),
      control: (args) => fetchMutation(api.notion.control, { secret, ...args }, { url }),
      receiveWebhook: (args) => fetchMutation(api.notion.receiveWebhook, { secret, ...args }, { url }),
    },
  };
}
export async function notionRoute(kind: Parameters<typeof handleNotionRequest>[0], request: Request) {
  try {
    if (kind === "webhook") {
      const captured = await captureNotionWebhookVerification(request);
      if (captured) return captured;
    }
    const deps = notionHttpDependencies();
    if (!deps) return Response.json({ error: "notion_setup_disabled" }, { status: 503, headers: { "cache-control": "no-store" } });
    return await handleNotionRequest(kind, request, deps);
  } catch { return Response.json({ error: "temporarily_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
export async function getNotionManagement() {
  const origin = getNotionInstallationOrigin();
  if (!origin) return null;
  const rawSession = (await cookies()).get(notionCookieNames(origin).session)?.value;
  if (!rawSession) return null;
  const secret = required("CONVEX_SERVER_SECRET");
  const state = await fetchQuery(api.notion.management, { secret, sessionHash: notionHash(rawSession), now: Date.now() }, { url: required("NEXT_PUBLIC_CONVEX_URL") });
  return state ? { ...state, csrfToken: notionCsrf(rawSession, secret) } : null;
}

export async function getNotionDisconnectReceipt() {
  const origin = getNotionInstallationOrigin();
  if (!origin) return null;
  const rawSession = (await cookies()).get(notionCookieNames(origin).session)?.value;
  if (!rawSession) return null;
  return fetchQuery(api.notion.disconnectReceipt, {
    secret: required("CONVEX_SERVER_SECRET"), sessionHash: notionHash(rawSession), now: Date.now(),
  }, { url: required("NEXT_PUBLIC_CONVEX_URL") });
}
