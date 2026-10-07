import { CircleHelp, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getPublicShare } from "@/db/queries";
import { Button } from "@/components/ui/button";

const headlines = {
  EAT: "No matching warning found",
  YEET: "Warning match found",
  MAYBE_YEET: "Possible warning match",
  NO_CLUE: "Not enough details",
} as const;
type ShareVerdict = keyof typeof headlines;

function isShareVerdict(value: string): value is ShareVerdict {
  return Object.hasOwn(headlines, value);
}

function formatDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function resultDescription(verdict: keyof typeof headlines): string {
  return verdict === "EAT"
    ? "No matching warning was found. This checks published warnings, not whether food is safe to eat."
    : verdict === "YEET"
      ? "These details matched a published food-safety warning."
      : verdict === "MAYBE_YEET"
        ? "Some details matched a published food-safety warning."
        : "There were not enough details for a useful comparison.";
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const share = await getPublicShare(id);
  if (!share) return { title: "Result not found", robots: { index: false, follow: false } };
  const verdict = isShareVerdict(share.verdict) ? share.verdict : "NO_CLUE";
  return {
    title: headlines[verdict],
    description: resultDescription(verdict),
    robots: { index: false, follow: true },
  };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const share = await getPublicShare(id);
  if (!share) notFound();
  const verdict = isShareVerdict(share.verdict) ? share.verdict : "NO_CLUE";
  const hasCoverage = share.checkedAt !== null;
  const isNoMatch = verdict === "EAT";
  const isWarning = verdict === "YEET" || verdict === "MAYBE_YEET";
  const Icon = isWarning ? TriangleAlert : CircleHelp;
  const className = isWarning ? "bg-yeet-soft text-yeet" : "bg-secondary text-foreground";

  return (
    <div className="page-shell grid flex-1 place-items-center py-10 sm:py-14">
      <div className="w-full max-w-2xl">
        <section className={`rounded-xl p-6 sm:p-9 ${className}`} aria-labelledby="share-heading">
          <div className="flex items-center justify-between gap-4 font-bold"><span>Eat or Yeet · warning check</span><Icon className="size-7" aria-hidden /></div>
          <h1 id="share-heading" className="mt-10 text-4xl font-black leading-[.98] tracking-[-0.035em] sm:text-6xl">{headlines[verdict]}</h1>
          <p className="mt-5 text-lg font-bold">{resultDescription(verdict)}</p>
          {hasCoverage && share.productName ? <div className="mt-6 border-t border-current/20 pt-4"><p className="text-xs font-bold uppercase tracking-wide">Official warning</p><p className="mt-2 text-lg font-semibold">{share.productName}</p></div> : null}
        </section>

        {isNoMatch ? <p className="mt-4 rounded-xl border p-4 text-sm leading-6"><strong>No matching warning found.</strong> This checks published warnings, not whether food is safe to eat. Follow storage instructions, use-by dates, and official food-safety advice.</p> : null}

        <section className="mt-5 rounded-xl border p-5" aria-labelledby="share-data-heading">
          <h2 id="share-data-heading" className="font-black">Check details</h2>
          {hasCoverage ? (
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Checked</dt><dd className="mt-1 font-semibold">{formatDate(share.checkedAt) ?? "Date unavailable"}</dd></div>
              <div><dt className="text-muted-foreground">Region</dt><dd className="mt-1 font-semibold">{share.datasetRegions.length ? share.datasetRegions.join(" + ") : "Coverage unknown"}</dd></div>
              {share.sourceScope ? <div className="sm:col-span-2"><dt className="text-muted-foreground">Data source scope</dt><dd className="mt-1 font-semibold">{share.sourceScope}</dd></div> : null}
            </dl>
          ) : <p className="mt-2 text-sm leading-6 text-muted-foreground">This is a historical result. Its check date and warning coverage are unknown.</p>}
        </section>

        {hasCoverage && share.incidentSlug ? <Link href={`/incidents/${share.incidentSlug}`} className="mt-4 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">Read the official warning</Link> : null}
        <Button asChild size="lg" className="tactile mt-7 w-full rounded-full"><Link href="/scan">Check a barcode</Link></Button>
      </div>
    </div>
  );
}
