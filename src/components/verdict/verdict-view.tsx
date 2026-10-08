"use client";

import { CircleHelp, ExternalLink, Link2, Pencil, RotateCcw, Share2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { DatasetStatus, VerdictResult } from "@/lib/domain/types";
import { publicOfficialSource } from "@/lib/incidents/public-source";

type PresentedVerdict = {
  headline: string;
  subheading: string;
  summary: string;
  className: string;
  Icon: typeof TriangleAlert;
};

const presentation: Record<VerdictResult["verdict"], PresentedVerdict> = {
  EAT: {
    headline: "No matching warning found",
    subheading: "No published warning matched these details.",
    summary: "We did not find a match in the warning data shown below.",
    className: "bg-secondary text-foreground",
    Icon: CircleHelp,
  },
  YEET: {
    headline: "Warning match found",
    subheading: "These details strongly match a published warning.",
    summary: "Check the affected products and follow the official advice below.",
    className: "bg-yeet-soft text-yeet",
    Icon: TriangleAlert,
  },
  MAYBE_YEET: {
    headline: "Possible warning match",
    subheading: "Some details match a published warning.",
    summary: "We could not confirm an exact product or batch match. Compare the warning details below.",
    className: "bg-maybe-soft text-maybe",
    Icon: TriangleAlert,
  },
  NO_CLUE: {
    headline: "Not enough details",
    subheading: "We could not make a useful comparison.",
    summary: "Add a barcode, product name, producer, or batch code and check again.",
    className: "bg-muted text-foreground",
    Icon: CircleHelp,
  },
};

const matchLevelNames: Record<VerdictResult["matchLevel"], string> = {
  confirmed: "Exact match",
  probable: "Strong match",
  possible: "Partial match",
  contextual: "Related details only",
  none: "No match",
};

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function sourceStatusCopy(status: DatasetStatus["sources"][number]["status"]): string {
  switch (status) {
    case "healthy": return "Available";
    case "stale": return "May be out of date";
    case "failed": return "Could not refresh";
    case "missing": return "No data available";
  }
}

export function VerdictView({ result, onReset, onEdit, onRetry }: { result: VerdictResult; onReset: () => void; onEdit?: () => void; onRetry?: () => void }) {
  const dataIncomplete = result.verdict === "NO_CLUE" && (result.inconclusiveReason === "incomplete_data" || result.datasetStatus?.healthy === false);
  const unavailableSources = result.datasetStatus?.sources.filter((source) => source.status !== "healthy").map((source) => source.name) ?? [];
  const view: PresentedVerdict = dataIncomplete ? {
    ...presentation.NO_CLUE,
    headline: "Warning data incomplete",
    subheading: "We couldn't complete this warning check.",
    summary: unavailableSources.length
      ? `Current data from ${unavailableSources.join(", ")} is unavailable. Try again later.`
      : "Current warning data is unavailable. Try again later.",
  } : presentation[result.verdict];
  const Icon = view.Icon;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const topMatch = result.matches[0];
  const officialSource = topMatch ? publicOfficialSource(topMatch.incident) : null;
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const checkedAt = formatDate(result.datasetStatus?.checkedAt ?? result.checkedAt);
  const regions = result.datasetStatus?.regions.length ? result.datasetStatus.regions : result.datasetRegions;
  const sourceScope = result.datasetStatus?.sources.map((source) => `${source.name} — ${source.scope}`).filter(Boolean) ?? [];
  const extraDetails = Boolean(result.observation.productName || result.observation.brand || result.observation.batchCode || result.observation.lotCode || result.observation.producer);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const shareText = result.verdict === "EAT"
    ? "No matching warning found. This checks published warnings, not whether food is safe to eat."
    : result.verdict === "YEET"
      ? "A published warning matched these details."
      : result.verdict === "MAYBE_YEET"
        ? "Some details matched a published warning."
        : dataIncomplete
          ? "The warning check could not be completed because official data was unavailable."
          : "There were not enough details for a useful comparison.";

  async function copyUrl(url: string, success: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(url);
      setFallbackUrl(null);
      setShareStatus(success);
    } catch {
      setFallbackUrl(url);
      setShareStatus("Copying is unavailable. Select the link below to copy it.");
    }
  }

  async function shareVerdict() {
    const url = window.location.origin;
    setFallbackUrl(null);
    try {
      if (navigator.share) {
        await navigator.share({ title: "Eat or Yeet warning check", text: shareText, url });
        setShareStatus("Share sheet opened.");
      } else {
        await copyUrl(`${shareText}\n${url}`, "Share link copied.");
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setFallbackUrl(url);
      setShareStatus("Sharing is unavailable. You can still open or copy the link below.");
    }
  }

  async function createPublicLink() {
    if (!result.shareToken) {
      setShareStatus("Run the check again before creating a public link.");
      return;
    }

    setShareStatus("Creating a public link…");
    setFallbackUrl(null);
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: result.shareToken }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Couldn't create the link.");
      if (typeof payload?.url !== "string") throw new Error("Couldn't create the link.");
      await copyUrl(payload.url, "Public link copied. It expires after 24 hours.");
    } catch (cause) {
      setShareStatus(cause instanceof Error ? cause.message : "Couldn't create the link.");
    }
  }

  return (
    <div className="space-y-5">
      <section className={`verdict-reveal overflow-hidden rounded-xl ${view.className}`} aria-labelledby="verdict-heading" aria-live="polite">
        <div className="p-6 sm:p-9">
          <Icon className="size-8 shrink-0" aria-hidden />
          <h1 id="verdict-heading" ref={headingRef} tabIndex={-1} className="mt-6 max-w-3xl text-4xl font-black leading-[.98] tracking-[-0.035em] focus-visible:outline-none sm:text-6xl">{view.headline}</h1>
          <p className="mt-5 text-lg font-bold">{view.subheading}</p>
          <p className="mt-2 max-w-xl leading-7 text-foreground/75 dark:text-foreground/80">{view.summary}</p>
          {result.observation.productName ? <p className="mt-5 text-sm leading-6"><span className="font-semibold">Product: {result.observation.productName}</span>{result.observation.brand ? ` · ${result.observation.brand}` : ""}</p> : null}
          {result.verdict !== "EAT" && result.matchLevel !== "none" ? <Badge variant="outline" className="mt-5 border-current/30 bg-transparent">{matchLevelNames[result.matchLevel]}</Badge> : null}
          <p className="mt-5 text-sm font-medium">{`${dataIncomplete ? "Check attempted for" : "Checked against"} published ${regions.length ? `${regions.join(" + ")} ` : ""}warnings${checkedAt ? ` · ${checkedAt}` : ""}`}</p>
          {onEdit || (dataIncomplete && onRetry) ? <div className="mt-6 flex flex-wrap gap-3 border-t border-current/20 pt-4">
            {dataIncomplete && onRetry ? <Button type="button" size="sm" variant="solid" className="rounded-full" onClick={onRetry}><RotateCcw aria-hidden />Check again</Button> : null}
            {onEdit ? <Button type="button" size="sm" variant="outline" className="rounded-full border-current/30 bg-transparent hover:bg-background/40" onClick={onEdit}><Pencil aria-hidden />{extraDetails ? "Edit details" : "Add label details"}</Button> : null}
          </div> : null}
        </div>
      </section>

      {result.verdict === "EAT" ? <p className="rounded-xl border p-4 text-sm leading-6"><strong>No matching warning found.</strong> This checks published warnings, not whether food is safe to eat.</p> : null}

      {topMatch ? (
        <section className="rounded-xl border p-5 sm:p-7">
          <h2 className="text-xl font-black">Matching warning</h2>
          {result.matchCount !== undefined && result.matchCount > result.matches.length ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{result.matchCount} warnings match; the strongest match is shown here.</p> : null}
          <ul className="mt-4 space-y-3">{topMatch.reasons.map((reason, index) => <li key={`${reason.type}-${index}`} className="flex gap-3 text-sm leading-6"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-current" />{reason.message}</li>)}</ul>
          <div className="mt-6 rounded-lg bg-yeet-soft p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-yeet">Official consumer advice</p>
            <p className="mt-2 text-sm font-semibold leading-6">{topMatch.incident.consumerAdvice}</p>
          </div>
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Warning</dt><dd className="font-semibold">{topMatch.incident.title}</dd></div>
            <div><dt className="text-muted-foreground">Hazard</dt><dd className="font-semibold">{topMatch.incident.pathogen ?? topMatch.incident.hazard ?? "See official warning"}</dd></div>
            <div><dt className="text-muted-foreground">Authority</dt><dd className="font-semibold">{topMatch.incident.authority}</dd></div>
            <div><dt className="text-muted-foreground">Warning updated</dt><dd className="font-semibold">{formatDate(topMatch.incident.updatedAt.toString()) ?? "See official source"}</dd></div>
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild variant="secondary"><a href={officialSource?.url} target="_blank" rel="noreferrer">{officialSource?.label}<ExternalLink aria-hidden /></a></Button>
            <Button asChild variant="outline"><Link href={`/incidents/${topMatch.incident.slug}`}>Full warning</Link></Button>
          </div>
          {officialSource?.note ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{officialSource?.note}</p> : null}
        </section>
      ) : null}

      <section className="rounded-xl border p-5 sm:p-6" aria-labelledby="data-heading">
        <h2 id="data-heading" className="text-lg font-black">Data used for this check</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Checked</dt><dd className="mt-1 font-semibold">{checkedAt ?? "Date unavailable"}</dd></div>
          <div><dt className="text-muted-foreground">Region</dt><dd className="mt-1 font-semibold">{regions.length ? regions.join(" + ") : "Coverage unknown"}</dd></div>
        </dl>
        {sourceScope.length ? (
          <div className="mt-4 border-t pt-4">
            <h3 className="text-sm font-bold">Official data sources</h3>
            <ul className="mt-2 space-y-3 text-sm">
              {result.datasetStatus?.sources.map((source) => (
                <li key={source.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                  <span className="font-semibold">{source.name} <span className="font-normal text-muted-foreground">· {source.scope}</span></span>
                  <span className="text-muted-foreground">{sourceStatusCopy(source.status)}{source.lastSuccessfulAt ? ` · last updated ${formatDate(source.lastSuccessfulAt) ?? "date unavailable"}` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : <p className="mt-3 text-sm leading-6 text-muted-foreground">Official warning data for the selected region was checked. Source freshness details are unavailable.</p>}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Button onClick={() => void shareVerdict()} variant="solid" size="lg" className="h-11 rounded-full font-bold"><Share2 aria-hidden />Share result</Button>
        {result.shareToken && result.verdict !== "NO_CLUE" ? <Button onClick={() => void createPublicLink()} size="lg" variant="outline" className="rounded-full"><Link2 aria-hidden />Create public link</Button> : null}
        <Button onClick={onReset} variant="ghost" className="sm:col-span-2"><RotateCcw aria-hidden />Check something else</Button>
      </div>
      {shareStatus ? <p className="rounded-xl bg-card p-4 text-sm" role="status" aria-live="polite">{shareStatus}</p> : null}
      {fallbackUrl ? <div className="space-y-2 rounded-xl bg-card p-4"><Label htmlFor="share-fallback-url">Share link</Label><textarea id="share-fallback-url" readOnly value={fallbackUrl} onFocus={(event) => event.currentTarget.select()} rows={2} className="w-full rounded-md border bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" /><a href={fallbackUrl.split("\n").at(-1) ?? fallbackUrl} className="inline-flex min-h-10 items-center font-semibold underline underline-offset-4">Open link</a></div> : null}
    </div>
  );
}
