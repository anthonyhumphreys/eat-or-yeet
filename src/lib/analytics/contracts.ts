import { z } from "zod";

export const ANALYTICS_CONSENT_COOKIE = "eat-or-yeet-analytics";
export const ANALYTICS_CONSENT_VERSION = "v1";
export const ANALYTICS_CHOICE_DAYS = 180;
export const AnalyticsPageSchema = z.enum(["home", "warnings", "warning", "search", "scan", "integrations", "notion", "notion_manage", "privacy", "terms", "support", "shared_result", "other"]);
export const AnalyticsToolSchema = z.enum(["check_product", "search_warnings", "get_warning", "get_coverage"]);
export const WebsiteEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("website_page_viewed"), page: AnalyticsPageSchema }).strict(),
  z.object({ event: z.literal("website_check_started"), method: z.enum(["barcode", "details", "scan"]), region: z.enum(["UK", "US"]) }).strict(),
  z.object({ event: z.literal("website_check_finished"), method: z.enum(["barcode", "details", "scan"]), region: z.enum(["UK", "US"]), outcome: z.enum(["EAT", "MAYBE_YEET", "YEET", "NO_CLUE", "error"]) }).strict(),
]);
export const WebsiteCaptureSchema = z.object({ data: WebsiteEventSchema }).strict();
export const AppCaptureSchema = z.object({
  consent: z.literal(true), host: z.enum(["chatgpt", "other"]),
  event: z.enum(["app_opened", "app_tool_requested"]), tool: AnalyticsToolSchema.optional(),
}).strict();
export type WebsiteEvent = z.infer<typeof WebsiteEventSchema>;

/** Route categories only: no warning slugs, share tokens, query strings or fragments. */
export function analyticsPage(pathname: string): z.infer<typeof AnalyticsPageSchema> {
  const paths: Record<string, z.infer<typeof AnalyticsPageSchema>> = {
    "/": "home", "/incidents": "warnings", "/search": "search", "/scan": "scan", "/integrations": "integrations",
    "/integrations/notion": "notion", "/integrations/notion/manage": "notion_manage", "/privacy": "privacy", "/terms": "terms", "/support": "support",
  };
  if (pathname.startsWith("/incidents/")) return "warning";
  if (pathname.startsWith("/s/")) return "shared_result";
  return paths[pathname] ?? "other";
}
