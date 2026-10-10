import { describe, expect, it } from "vitest";

import { getNotionInstallationOrigin } from "../src/lib/integrations/notion-installation";

describe("getNotionInstallationOrigin", () => {
  it("keeps the customer installation disabled by default", () => {
    expect(getNotionInstallationOrigin({ NODE_ENV: "test" })).toBeUndefined();
    expect(getNotionInstallationOrigin({ NODE_ENV: "test", NOTION_INSTALL_ENABLED: "false", NOTION_SERVICE_URL: "https://notion.example" })).toBeUndefined();
  });

  it("returns only a configured HTTPS origin when enabled", () => {
    expect(getNotionInstallationOrigin({
      NOTION_INSTALL_ENABLED: "true",
      NOTION_SERVICE_URL: "https://notion.example/",
      NODE_ENV: "production",
    })).toBe("https://notion.example");
  });

  it("allows localhost with a port only in development", () => {
    expect(getNotionInstallationOrigin({
      NOTION_INSTALL_ENABLED: "true",
      NOTION_SERVICE_URL: "http://localhost:4312",
      NODE_ENV: "development",
    })).toBe("http://localhost:4312");
    expect(getNotionInstallationOrigin({
      NOTION_INSTALL_ENABLED: "true",
      NOTION_SERVICE_URL: "http://localhost:4312",
      NODE_ENV: "production",
    })).toBeUndefined();
    expect(getNotionInstallationOrigin({
      NOTION_INSTALL_ENABLED: "true",
      NOTION_SERVICE_URL: "http://localhost",
      NODE_ENV: "development",
    })).toBeUndefined();
  });

  it.each([
    "https://user:password@notion.example",
    "https://notion.example/path",
    "https://notion.example/../",
    "https://notion.example/%2e%2e",
    "https://notion.example?next=/connect",
    "https://notion.example#connect",
    "https://notion.example/?",
    "http://notion.example:4312",
    "http://127.0.0.1:4312",
    "javascript:alert(1)",
    "not a URL",
  ])("rejects unsafe or malformed service URL %s", (serviceUrl) => {
    expect(getNotionInstallationOrigin({
      NOTION_INSTALL_ENABLED: "true",
      NOTION_SERVICE_URL: serviceUrl,
      NODE_ENV: "development",
    })).toBeUndefined();
  });
});
