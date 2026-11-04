import type { AnalyticsPage } from "./contracts";

export const ANALYTICS_CONSENT_COOKIE = "eat-or-yeet-analytics";
export const ANALYTICS_CONSENT_VERSION = "v1";
export const ANALYTICS_CHOICE_DAYS = 180;

const pages: Record<string, AnalyticsPage> = {
  "/": "home", "/incidents": "warnings", "/search": "search", "/scan": "scan", "/integrations": "integrations",
  "/integrations/notion": "notion", "/integrations/notion/manage": "notion_manage", "/privacy": "privacy", "/terms": "terms", "/support": "support",
};

/** Route categories only: no warning slugs, share tokens, query strings or fragments. */
export function analyticsPage(pathname: string): AnalyticsPage {
  if (pathname.startsWith("/incidents/")) return "warning";
  if (pathname.startsWith("/s/")) return "shared_result";
  return pages[pathname] ?? "other";
}
