import { describe, expect, it } from "vitest";

import { getNotionInstallationOrigin, getNotionSetupOrigin } from "../src/lib/integrations/notion-installation";

describe("getNotionInstallationOrigin", () => {
  it("keeps managed Notion setup disabled unless explicitly enabled", () => {
    expect(getNotionInstallationOrigin({ NODE_ENV: "test", NEXT_PUBLIC_APP_URL: "https://eatoryeet.app" })).toBeUndefined();
    expect(getNotionInstallationOrigin({ NODE_ENV: "test", NOTION_INSTALL_ENABLED: "false", NEXT_PUBLIC_APP_URL: "https://eatoryeet.app" })).toBeUndefined();
  });

  it("returns the canonical configured HTTPS application origin", () => {
    expect(getNotionInstallationOrigin({
      NODE_ENV: "production",
      NOTION_INSTALL_ENABLED: "true",
      NEXT_PUBLIC_APP_URL: "https://eatoryeet.app/",
    })).toBe("https://eatoryeet.app");
  });

  it("allows an HTTP localhost app origin only in development", () => {
    expect(getNotionInstallationOrigin({
      NODE_ENV: "development",
      NOTION_INSTALL_ENABLED: "true",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    })).toBe("http://localhost:3000");
    expect(getNotionInstallationOrigin({
      NODE_ENV: "production",
      NOTION_INSTALL_ENABLED: "true",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    })).toBeUndefined();
    expect(getNotionInstallationOrigin({
      NODE_ENV: "development",
      NOTION_INSTALL_ENABLED: "true",
      NEXT_PUBLIC_APP_URL: "http://localhost",
    })).toBeUndefined();
  });

  it.each([
    "https://user:password@eatoryeet.app",
    "https://eatoryeet.app/path",
    "https://eatoryeet.app/../",
    "https://eatoryeet.app/%2e%2e",
    "https://eatoryeet.app?next=/connect",
    "https://eatoryeet.app#connect",
    "https://eatoryeet.app/?",
    "http://eatoryeet.app:3000",
    "http://127.0.0.1:3000",
    "javascript:alert(1)",
    "not a URL",
  ])("rejects unsafe or malformed application URL %s", (appUrl) => {
    expect(getNotionInstallationOrigin({
      NODE_ENV: "development",
      NOTION_INSTALL_ENABLED: "true",
      NEXT_PUBLIC_APP_URL: appUrl,
    })).toBeUndefined();
  });
});

describe("getNotionSetupOrigin", () => {
  const configured: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    NOTION_INSTALL_ENABLED: "true",
    NEXT_PUBLIC_APP_URL: "https://www.eatoryeet.app",
    BACKEND_SECRET: "test-server-secret",
    BACKEND_URL: "https://example.workers.dev",
    NOTION_CLIENT_ID: "test-client",
    NOTION_CLIENT_SECRET: "test-client-secret",
    NOTION_CREDENTIAL_KEY: Buffer.alloc(32, 1).toString("base64"),
    NOTION_INTEGRATION_ID: "test-integration",
    NOTION_SUBSCRIPTION_ID: "test-subscription",
    NOTION_WEBHOOK_VERIFICATION_TOKEN: "test-webhook-token",
  };

  it("offers setup only with complete configuration and a valid, enabled origin", () => {
    expect(getNotionSetupOrigin(configured)).toBe("https://www.eatoryeet.app");
    expect(getNotionSetupOrigin({ ...configured, NOTION_INSTALL_ENABLED: "false" })).toBeUndefined();
    expect(getNotionSetupOrigin({ ...configured, NEXT_PUBLIC_APP_URL: "https://www.eatoryeet.app/path" })).toBeUndefined();
  });

  it.each([
    "BACKEND_SECRET", "BACKEND_URL", "NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET",
    "NOTION_CREDENTIAL_KEY", "NOTION_INTEGRATION_ID", "NOTION_SUBSCRIPTION_ID", "NOTION_WEBHOOK_VERIFICATION_TOKEN",
  ])("withholds setup when %s is missing or blank", (name) => {
    expect(getNotionSetupOrigin({ ...configured, [name]: undefined })).toBeUndefined();
    expect(getNotionSetupOrigin({ ...configured, [name]: "  " })).toBeUndefined();
  });
});
