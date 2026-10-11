"use client";
import { ANALYTICS_CONSENT_COOKIE, ANALYTICS_CONSENT_VERSION, WebsiteEventSchema, type WebsiteEvent } from "./contracts";

export const ANALYTICS_PREFERENCES_EVENT = "eat-or-yeet-analytics-preferences";
export const ANALYTICS_CHOICE_EVENT = "eat-or-yeet-analytics-choice";
let enabled = false;
const pending = new Set<AbortController>();

export function privacySignal(): boolean {
  return navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}
export function analyticsChoice(): "accepted" | "declined" | null {
  const value = document.cookie.split("; ").find((cookie) => cookie.startsWith(`${ANALYTICS_CONSENT_COOKIE}=`))?.split("=")[1];
  return value === `${ANALYTICS_CONSENT_VERSION}.accepted` ? "accepted" : value === `${ANALYTICS_CONSENT_VERSION}.declined` ? "declined" : null;
}
export function stopBrowserAnalytics() {
  for (const controller of pending) controller.abort();
  pending.clear();
}
export function configureBrowserAnalytics(value: boolean) { enabled = value; if (!value) stopBrowserAnalytics(); }
export function trackWebsiteEvent(data: WebsiteEvent) {
  if (!enabled || privacySignal() || analyticsChoice() !== "accepted") { stopBrowserAnalytics(); return; }
  const parsed = WebsiteEventSchema.safeParse(data);
  if (!parsed.success) return;
  const controller = new AbortController(); pending.add(controller);
  void fetch("/api/analytics", {
    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", referrerPolicy: "no-referrer",
    signal: controller.signal, body: JSON.stringify({ data: parsed.data }),
  }).catch(() => undefined).finally(() => pending.delete(controller));
}
