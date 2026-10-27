"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export const BROWSE_POSITION_KEY = "eat-or-yeet-browse-position";

export function rememberBrowsePosition(url: string, slug?: string) {
  try { sessionStorage.setItem(BROWSE_POSITION_KEY, JSON.stringify({ url, slug, y: window.scrollY })); } catch { /* Browsing works when storage is unavailable. */ }
}

export function RecallLink({ slug, returnTo, children, className }: { slug: string; returnTo: string; children: ReactNode; className?: string }) {
  return <Link href={`/incidents/${slug}?returnTo=${encodeURIComponent(returnTo)}`} prefetch={false} data-recall-slug={slug} className={className} onNavigate={() => {
    // Flush a pending debounced URL update before Next saves the history entry.
    window.history.replaceState(window.history.state, "", returnTo);
    rememberBrowsePosition(returnTo, slug);
  }}>{children}</Link>;
}
