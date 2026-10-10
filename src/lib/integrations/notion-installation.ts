/** Return the configured Notion installation origin when the customer flow is enabled. */
export function getNotionInstallationOrigin(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  if (environment.NOTION_INSTALL_ENABLED !== "true") return undefined;

  const configuredUrl = environment.NOTION_SERVICE_URL;
  if (!configuredUrl) return undefined;

  const rawOrigin = /^https?:\/\/[^/?#]+/i.exec(configuredUrl)?.[0];
  if (!rawOrigin || !["", "/"].includes(configuredUrl.slice(rawOrigin.length))) return undefined;

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    return undefined;
  }

  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return undefined;
  // URL.search and URL.hash are empty for a trailing '?' or '#', so check the
  // normalized URL too to reject those ambiguous origin strings.
  if (url.href.includes("?") || url.href.includes("#")) return undefined;

  if (url.protocol === "https:") return url.origin;

  if (
    url.protocol === "http:" &&
    environment.NODE_ENV === "development" &&
    url.hostname === "localhost" &&
    url.port !== ""
  ) {
    return url.origin;
  }

  return undefined;
}
