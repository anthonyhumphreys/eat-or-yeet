import { describe, expect, it } from "vitest";

import { getNotionInstallationOrigin } from "../src/lib/integrations/notion-installation";

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
