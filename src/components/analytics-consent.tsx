"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useLocation } from "./location-provider";
import { ANALYTICS_CHOICE_DAYS, ANALYTICS_CONSENT_COOKIE, ANALYTICS_CONSENT_VERSION, analyticsPage } from "@/lib/analytics/contracts";
import { ANALYTICS_CHOICE_EVENT, ANALYTICS_PREFERENCES_EVENT, analyticsChoice, configureBrowserAnalytics, privacySignal, stopBrowserAnalytics, trackWebsiteEvent } from "@/lib/analytics/browser";

function subscribe(listener: () => void) {
  window.addEventListener(ANALYTICS_CHOICE_EVENT, listener);
  window.addEventListener("focus", listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(ANALYTICS_CHOICE_EVENT, listener);
    window.removeEventListener("focus", listener);
    window.removeEventListener("storage", listener);
  };
}
function snapshot() { return privacySignal() ? "privacy_signal" : analyticsChoice() ?? "unset"; }

export function AnalyticsConsent({ enabled }: { enabled: boolean }) {
  const choice = useSyncExternalStore(subscribe, snapshot, () => "loading");
  const [editing, setEditing] = useState(false);
  const pathname = usePathname();
  const { needsRegionChoice } = useLocation();
  useEffect(() => {
    const edit = () => setEditing(true);
    window.addEventListener(ANALYTICS_PREFERENCES_EVENT, edit);
    return () => window.removeEventListener(ANALYTICS_PREFERENCES_EVENT, edit);
  }, []);
  useEffect(() => {
    configureBrowserAnalytics(enabled);
    if (enabled && choice === "accepted") trackWebsiteEvent({ event: "website_page_viewed", page: analyticsPage(pathname) });
    else if (choice !== "loading") stopBrowserAnalytics();
  }, [enabled, choice, pathname]);

  function choose(accepted: boolean) {
    document.cookie = `${ANALYTICS_CONSENT_COOKIE}=${ANALYTICS_CONSENT_VERSION}.${accepted ? "accepted" : "declined"}; Max-Age=${ANALYTICS_CHOICE_DAYS * 86400}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    if (!accepted) stopBrowserAnalytics();
    // Notify other tabs without storing identifiers or generating an analytics event for the choice.
    try { localStorage.setItem(ANALYTICS_CHOICE_EVENT, String(Date.now())); } catch { /* Cookie still records the choice. */ }
    window.dispatchEvent(new Event(ANALYTICS_CHOICE_EVENT)); setEditing(false);
  }

  if (choice === "loading" || needsRegionChoice || (!editing && (!enabled || choice !== "unset"))) return null;
  const buttonClass = "min-h-11 rounded-full border border-foreground px-5 font-semibold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
  return (
    <section className="fixed inset-x-0 bottom-0 z-40 max-h-[50svh] overflow-y-auto border-t bg-card py-5" aria-labelledby="analytics-heading">
      <div className="page-shell flex flex-wrap items-center justify-between gap-5">
        <div className="max-w-2xl">
          <h2 id="analytics-heading" className="text-lg font-bold">Help us improve Eat or Yeet?</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Optional PostHog analytics tells us which pages and checks get used. We exclude product details and do not record your screen. Choosing no will not affect checks. <Link className="underline underline-offset-4" href="/privacy#analytics">Privacy details</Link>.</p>
          {choice === "privacy_signal" && <p className="mt-2 text-sm leading-6">Analytics is off because your browser sends a privacy preference.</p>}
          {!enabled && <p className="mt-2 text-sm leading-6">Analytics is currently disabled.</p>}
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={buttonClass} onClick={() => choose(false)}>No analytics</button>
          {enabled && choice !== "privacy_signal" && <button type="button" className={buttonClass} onClick={() => choose(true)}>Allow analytics</button>}
          {editing && <button type="button" className={buttonClass} onClick={() => setEditing(false)}>Close</button>}
        </div>
      </div>
    </section>
  );
}

export function AnalyticsPreferencesButton() {
  return <button type="button" onClick={() => window.dispatchEvent(new Event(ANALYTICS_PREFERENCES_EVENT))} className="inline-flex min-h-11 items-center rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Analytics preferences</button>;
}
