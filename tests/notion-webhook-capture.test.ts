import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureNotionWebhookVerification, notionWebhookCaptureLabel } from "../src/lib/integrations/notion-http";
import { POST as webhookRoute } from "../src/app/api/notion/webhook/route";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2_048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const token = `secret_${"x".repeat(40)}`;
function environment(): NodeJS.ProcessEnv {
  return { NODE_ENV: "production", NOTION_INSTALL_ENABLED: "true", NEXT_PUBLIC_APP_URL: "https://www.eatoryeet.app", NOTION_WEBHOOK_SETUP_PUBLIC_KEY: publicKey, NOTION_WEBHOOK_SETUP_EXPIRES_AT: String(Date.now() + 10 * 60_000) };
}
function request(body: unknown = { verification_token: token }, headers: Record<string, string> = {}) {
  return new Request("https://www.eatoryeet.app/api/notion/webhook", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("operator-controlled Notion webhook verification capture", () => {
  it("captures through the real webhook route before OAuth configuration exists, without contacting Convex", async () => {
    for (const [name, value] of Object.entries(environment())) vi.stubEnv(name, value);
    vi.stubEnv("NOTION_CLIENT_SECRET", "");
    vi.stubEnv("NOTION_WEBHOOK_VERIFICATION_TOKEN", "");
    const external = vi.fn();
    vi.stubGlobal("fetch", external);
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await webhookRoute(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ received: true });
    expect(log).toHaveBeenCalledOnce();
    expect(external).not.toHaveBeenCalled();
  });

  it("records only decryptable ciphertext, without exposing or adopting the token", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const env = environment();
    const response = await captureNotionWebhookVerification(request(), env);
    expect(response?.status).toBe(202);
    expect(await response?.json()).toEqual({ received: true });
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(env.NOTION_WEBHOOK_VERIFICATION_TOKEN).toBeUndefined();
    const [label, encrypted] = log.mock.calls[0] as [string, string];
    expect(label).toBe("notion_webhook_verification_candidate");
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
    const decrypted = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256", oaepLabel: Buffer.from(notionWebhookCaptureLabel) }, Buffer.from(encrypted, "base64"));
    expect(decrypted.toString()).toBe(token);
  });

  it.each([
    { NOTION_INSTALL_ENABLED: "false" },
    { NOTION_WEBHOOK_SETUP_PUBLIC_KEY: "" },
    { NOTION_WEBHOOK_SETUP_EXPIRES_AT: "invalid" },
    { NOTION_WEBHOOK_SETUP_EXPIRES_AT: "1" },
    { NOTION_WEBHOOK_SETUP_EXPIRES_AT: String(Date.now() + 60 * 60_000) },
    { NOTION_WEBHOOK_VERIFICATION_TOKEN: "already-configured" },
  ])("does not capture outside an explicit short setup window: %j", async (overrides) => {
    const log = vi.spyOn(console, "info");
    expect(await captureNotionWebhookVerification(request(), { ...environment(), ...overrides })).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    { verification_token: token, extra: "not allowed" },
    { verification_token: "invalid" },
    { type: "page.created", id: "event" },
  ])("rejects non-verification bodies without logging them", async (payload) => {
    const log = vi.spyOn(console, "info");
    expect((await captureNotionWebhookVerification(request(payload), environment()))?.status).toBe(400);
    expect(log).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies, signed events and another origin", async () => {
    const log = vi.spyOn(console, "info");
    expect((await captureNotionWebhookVerification(request({ verification_token: "x".repeat(2_049) }), environment()))?.status).toBe(413);
    expect((await captureNotionWebhookVerification(request(undefined, { "x-notion-signature": "sha256=unused" }), environment()))?.status).toBe(400);
    const other = new Request("https://other.example/api/notion/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ verification_token: token }) });
    expect((await captureNotionWebhookVerification(other, environment()))?.status).toBe(400);
    expect(log).not.toHaveBeenCalled();
  });
});
