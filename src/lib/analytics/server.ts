import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";

type AnalyticsProperties = Record<string, string | number | boolean | null>;

export function analyticsEnabled() {
  return process.env.POSTHOG_ENABLED === "true" && Boolean(process.env.POSTHOG_PROJECT_TOKEN)
    && (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production")
    && process.env.POSTHOG_HOST === "https://eu.i.posthog.com";
}

/** Only callers constructing allowlisted properties may use this. Never pass request headers, inputs or errors. */
export async function captureEvent(event: string, properties: AnalyticsProperties): Promise<boolean> {
  if (!analyticsEnabled()) return false;
  try {
    const response = await fetch(`${process.env.POSTHOG_HOST}/i/v0/e/`, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(2_000),
      body: JSON.stringify({ api_key: process.env.POSTHOG_PROJECT_TOKEN, event, distinct_id: randomUUID(),
        properties: { ...properties, $process_person_profile: false, $geoip_disable: true, $ip: null, environment: "production", analytics_version: 1 } }),
    });
    await response.body?.cancel();
    return response.ok;
  } catch { return false; }
}

export function scheduleEvent(event: string, properties: AnalyticsProperties) {
  if (!analyticsEnabled()) return;
  try { after(async () => { await captureEvent(event, properties); }); }
  catch { /* No request lifecycle, such as a CLI test. Analytics never blocks the service. */ }
}

const outcomes = new Set(["ok", "warning_match", "possible_match", "no_matching_warning", "inconclusive", "invalid_arguments", "quota_exceeded", "unavailable", "restart_pagination", "response_too_large", "snapshot_limit", "interrupted", "not_found"]);
export function recordMcpOperation(tool: string, outcome: string, durationMs: number, isPrivate: boolean) {
  const normalizedOutcome = outcomes.has(outcome) ? outcome : "unavailable";
  // A new random ID for each invocation: no user, network, workspace, session or conversation identifier.
  scheduleEvent("$mcp_tool_call", {
    source: isPrivate ? "notion_mcp" : "public_mcp", $mcp_server_name: "eat-or-yeet", $mcp_tool_name: tool,
    $mcp_duration_ms: Math.max(0, Math.min(120_000, Math.round(durationMs / 100) * 100)),
    outcome: normalizedOutcome, $mcp_is_error: !["ok", "warning_match", "possible_match", "no_matching_warning", "inconclusive"].includes(normalizedOutcome),
  });
}
