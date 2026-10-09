"use client";

import { Check, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Shares the current page (with its filters) to a group chat: the phone's share sheet when
 * there is one, otherwise the link is copied.
 */
export function ShareButton({ title, text, label, url, className = "" }: { title: string; text?: string; label: string; url?: string; className?: string }) {
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(""), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function share() {
    const shareUrl = url ? new URL(url, window.location.href).href : window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setStatus("Link copied");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setStatus("Couldn’t copy. Copy the link from the address bar.");
    }
  }

  const copied = status === "Link copied";
  return (
    <>
      <button
        type="button"
        onClick={() => void share()}
        className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border bg-background px-4 text-sm font-bold transition-colors hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${className}`}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Share2 className="size-4" aria-hidden />}
        {copied ? "Link copied" : label}
      </button>
      <span role="status" className="sr-only">{status}</span>
    </>
  );
}
