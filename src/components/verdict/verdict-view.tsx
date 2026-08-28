"use client";

import { Camera, Check, ExternalLink, Link2, Pencil, RotateCcw, Share2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { VerdictResult } from "@/lib/domain/types";

const presentation = {
  EAT: {
    headline: "EAT",
    subheading: "Your dinner lives another day.",
    summary: "We couldn't find this product in any current food-safety warnings we know about.",
    className: "bg-eat-soft text-eat",
    icon: Check,
  },
  YEET: {
    headline: "YEET",
    subheading: "Yeah, maybe don't eat that.",
    summary: "This product information strongly matches a current food-safety warning.",
    className: "bg-yeet-soft text-yeet",
    icon: TriangleAlert,
  },
  MAYBE_YEET: {
    headline: "MAYBE YEET",
    subheading: "This one's looking a bit sus.",
    summary: "Something matches, but there isn't enough evidence to confirm this exact product or batch.",
    className: "bg-maybe-soft text-maybe",
    icon: TriangleAlert,
  },
  NO_CLUE: {
    headline: "NO CLUE",
    subheading: "We need a bit more evidence.",
    summary: "We need a little more evidence before we tell you to throw your dinner away.",
    className: "bg-muted text-foreground",
    icon: Camera,
  },
} as const;

export function VerdictView({ result, onReset, onAddPhoto, onEdit }: { result: VerdictResult; onReset: () => void; onAddPhoto: () => void; onEdit?: () => void }) {
  const view = presentation[result.verdict];
  const Icon = view.icon;
  const topMatch = result.matches[0];
  const checkedEvidence = result.observation.productName
    ? result.observation.productName
    : result.observation.barcode
      ? `Barcode ${result.observation.barcode}`
      : result.observation.producer
        ? result.observation.producer
        : null;
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const shareText = result.verdict === "EAT"
    ? "My dinner survived Eat or Yeet ✅\nScan it. Check it. Eat it or yeet it."
    : result.verdict === "YEET"
      ? "Eat or Yeet just told me to YEET this 🚨"
      : "Eat or Yeet says this one's a MAYBE YEET ⚠️";

  async function shareVerdict() {
    try {
      if (navigator.share) await navigator.share({ title: "Eat or Yeet verdict", text: shareText, url: window.location.origin });
      else {
        await navigator.clipboard.writeText(`${shareText}\n${window.location.origin}`);
        setShareStatus("Verdict copied.");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setShareStatus("Sharing didn't work on this device.");
    }
  }

  async function createPublicLink() {
    if (!result.shareToken) { setShareStatus("Run the check again before creating a public link."); return; }
    setShareStatus("Creating a sanitised public link…");
    const response = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: result.shareToken }),
    });
    const payload = await response.json();
    if (!response.ok) { setShareStatus(payload.error ?? "Couldn't create the link."); return; }
    await navigator.clipboard.writeText(payload.url);
    setShareStatus("Public link copied. It expires after 30 days.");
  }

  return (
    <div className="space-y-5">
      <section className={`verdict-reveal overflow-hidden rounded-xl ${view.className}`} aria-live="polite">
        <div className="p-6 sm:p-9">
          <div className="flex items-start justify-between gap-4"><Badge variant="outline" className="border-current/30 bg-transparent">{result.matchLevel.replace("_", " ")}</Badge><Icon className="size-8" aria-hidden /></div>
          <h1 className="mt-10 text-6xl font-black leading-[.86] tracking-[-0.04em] sm:text-8xl">{view.headline}</h1>
          <p className="mt-5 text-xl font-bold">{view.subheading}</p>
          <p className="mt-2 max-w-xl leading-7 text-foreground/75 dark:text-foreground/80">{view.summary}</p>
          {checkedEvidence || onEdit ? <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-current/20 pt-4">
            {checkedEvidence ? <p className="text-sm font-semibold">Checked: {checkedEvidence}</p> : <span />}
            {onEdit ? <Button type="button" size="sm" variant="outline" className="rounded-full border-current/30 bg-transparent hover:bg-background/40" onClick={onEdit}><Pencil aria-hidden />Edit details</Button> : null}
          </div> : null}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-current/20 pt-4 text-[0.7rem] font-bold tracking-[0.08em] opacity-70">
            <span>EAT OR YEET · OFFICIAL WARNINGS CHECKED</span>
            <span>{result.datasetRegions.join(" + ")} · {new Date(result.checkedAt).toLocaleDateString()}</span>
          </div>
        </div>
      </section>

      {topMatch ? (
        <section className="rounded-xl border p-5 sm:p-7">
          <h2 className="text-xl font-black">Why it matched</h2>
          <ul className="mt-4 space-y-3">{topMatch.reasons.map((reason, index) => <li key={`${reason.type}-${index}`} className="flex gap-3 text-sm leading-6"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-current" />{reason.message}</li>)}</ul>
          <div className="mt-6 rounded-lg bg-yeet-soft p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-yeet">Official consumer advice</p>
            <p className="mt-2 text-sm font-semibold leading-6">{topMatch.incident.consumerAdvice}</p>
          </div>
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Warning</dt><dd className="font-semibold">{topMatch.incident.title}</dd></div>
            <div><dt className="text-muted-foreground">Hazard</dt><dd className="font-semibold">{topMatch.incident.pathogen ?? topMatch.incident.hazard ?? "See official warning"}</dd></div>
            <div><dt className="text-muted-foreground">Authority</dt><dd className="font-semibold">{topMatch.incident.authority}</dd></div>
            <div><dt className="text-muted-foreground">Updated</dt><dd className="font-semibold">{new Date(topMatch.incident.updatedAt).toLocaleDateString()}</dd></div>
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild variant="secondary"><a href={topMatch.incident.authorityUrl} target="_blank" rel="noreferrer">Official source<ExternalLink aria-hidden /></a></Button>
            <Button asChild variant="outline"><Link href={`/incidents/${topMatch.incident.slug}`}>Full warning</Link></Button>
          </div>
        </section>
      ) : null}

      {result.verdict === "EAT" ? <p className="rounded-xl border p-4 text-sm leading-6 text-muted-foreground"><strong className="text-foreground">{"This doesn't guarantee the food is safe."}</strong> Always follow storage instructions, use-by dates and official food-safety advice.</p> : null}
      {result.verdict === "NO_CLUE" || result.verdict === "MAYBE_YEET" ? <p className="rounded-xl bg-card p-4 text-sm leading-6">A clearer photo of the barcode, batch or lot number, producer details, establishment mark, egg stamp, or date may give a stronger answer.</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Button onClick={shareVerdict} size="lg" className="rounded-full"><Share2 aria-hidden />Share my verdict</Button>
        {result.verdict !== "NO_CLUE" ? <Button onClick={createPublicLink} size="lg" variant="outline" className="rounded-full"><Link2 aria-hidden />Create public link</Button> : null}
        {(result.verdict === "MAYBE_YEET" || result.verdict === "NO_CLUE") ? <Button onClick={onAddPhoto} size="lg" variant="secondary" className="rounded-full sm:col-span-2"><Camera aria-hidden />Check another part of the pack</Button> : null}
        <Button onClick={onReset} variant="ghost" className="sm:col-span-2"><RotateCcw aria-hidden />Check something else</Button>
      </div>
      {shareStatus ? <p role="status" className="text-center text-sm text-muted-foreground">{shareStatus}</p> : null}
    </div>
  );
}
