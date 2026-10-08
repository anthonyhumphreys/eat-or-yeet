import { ChevronLeft, ExternalLink, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getIncidentBySlug } from "@/db/queries";
import { IncidentTargets } from "@/components/incidents/incident-targets";
import { Button } from "@/components/ui/button";
import { NewsList } from "@/components/news/news-list";
import { classifyHazard } from "@/lib/incidents/hazard";
import { publicOfficialSource } from "@/lib/incidents/public-source";
import { getFoodSafetyNews } from "@/lib/news/feed";
import { relatedNews } from "@/lib/news/related";

export const revalidate = 1800;

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London", timeZoneName: "short" });

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const incident = await getIncidentBySlug(slug);
  if (!incident) return { title: "Warning not found" };
  return { title: incident.title, description: incident.summary.slice(0, 160), alternates: { canonical: `/incidents/${slug}` } };
}

export default async function IncidentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const incident = await getIncidentBySlug(slug);
  if (!incident) notFound();
  const source = publicOfficialSource(incident);
  const news = await getFoodSafetyNews().catch(() => ({ articles: [], unavailable: true }));
  const related = relatedNews(news.articles, incident);
  const hazard = classifyHazard(incident);
  const hazardText = incident.hazard?.trim() || incident.pathogen;
  return (
    <article className="page-shell py-6 sm:py-10">
      <Link href={`/?region=${incident.region}`} className="-ml-2 mb-4 inline-flex min-h-10 items-center gap-1 rounded-full px-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><ChevronLeft className="size-4" aria-hidden />All {incident.region} warnings</Link>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12">
        <div className="min-w-0">
          <header>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-yeet px-2.5 py-0.5 text-xs font-bold text-white dark:text-background"><TriangleAlert className="size-3.5" aria-hidden />Active warning</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${hazard.kind === "pathogen" ? "bg-yeet-soft text-yeet" : "bg-secondary text-secondary-foreground"}`}>{hazard.label}</span>
              <span className="text-muted-foreground">{incident.authority} · Updated <time dateTime={incident.updatedAt.toISOString()}>{dateFormat.format(incident.updatedAt)}</time></span>
            </p>
            <h1 className="mt-4 max-w-3xl text-[1.75rem] font-black leading-[1.12] tracking-[-0.03em] sm:text-4xl">{incident.title}</h1>
          </header>

          <section aria-labelledby="advice-heading" className="mt-7 rounded-xl bg-yeet-soft p-5 sm:p-6">
            <h2 id="advice-heading" className="flex items-center gap-2 text-lg font-black text-yeet"><TriangleAlert className="size-5" aria-hidden />What to do</h2>
            <p className="mt-2 max-w-[65ch] font-semibold leading-7">{incident.consumerAdvice}</p>
          </section>

          <div className="mt-10 space-y-10">
            <section aria-labelledby="products-heading">
              <h2 id="products-heading" className="mb-4 text-xl font-black tracking-tight">Check your pack against these</h2>
              <IncidentTargets targets={incident.targets} />
              <p className="mt-3 text-sm leading-6 text-muted-foreground">Have it in front of you? <Link href="/scan" className="font-semibold text-foreground underline underline-offset-4">Scan the barcode</Link> to compare it automatically.</p>
            </section>
            <section aria-labelledby="summary-heading">
              <h2 id="summary-heading" className="text-xl font-black tracking-tight">What happened</h2>
              <p className="mt-3 max-w-[65ch] leading-7 text-muted-foreground">{incident.summary}</p>
              {hazardText && hazardText !== incident.summary ? <p className="mt-3 max-w-[65ch] whitespace-pre-line text-sm leading-6 text-muted-foreground">{hazardText}</p> : null}
            </section>
          </div>
        </div>

        <aside className="space-y-10 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-xl bg-card p-5 text-sm">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3">
              <dt className="text-muted-foreground">Authority</dt><dd className="font-semibold">{incident.authority}</dd>
              <dt className="text-muted-foreground">Published</dt><dd className="font-semibold tabular-nums">{dateFormat.format(incident.publishedAt)}</dd>
              <dt className="text-muted-foreground">Updated</dt><dd className="font-semibold tabular-nums">{dateTimeFormat.format(incident.updatedAt)}</dd>
              <dt className="text-muted-foreground">Reference</dt><dd className="font-mono text-xs leading-5">{incident.sourceId}</dd>
            </dl>
            <Button asChild variant="solid" className="mt-5 h-11 w-full rounded-full font-bold"><a href={source.url} target="_blank" rel="noreferrer">{source.label}<ExternalLink aria-hidden /><span className="sr-only">, opens in a new tab</span></a></Button>
            {source.note ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{source.note}</p> : null}
          </div>
          {related.length ? <NewsList heading="Related news" articles={related} /> : null}
        </aside>
      </div>
    </article>
  );
}
