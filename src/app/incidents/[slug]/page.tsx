import { ArrowRight, ChevronLeft, ExternalLink, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getIncidentBySlug } from "@/db/queries";
import { IncidentTargets } from "@/components/incidents/incident-targets";
import { NewsList } from "@/components/news/news-list";
import { ShareButton } from "@/components/share-button";
import { Button } from "@/components/ui/button";
import { classifyHazard } from "@/lib/incidents/hazard";
import { publicOfficialSource } from "@/lib/incidents/public-source";
import { formatRecallDate, timeAgo } from "@/lib/incidents/recency";
import { getFoodSafetyNews } from "@/lib/news/feed";
import { relatedNews } from "@/lib/news/related";

export const revalidate = 1800;

const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London", timeZoneName: "short" });
const FDA = "U.S. Food and Drug Administration";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const incident = await getIncidentBySlug(slug);
  if (!incident) return { title: "Warning not found" };
  return { title: incident.title, description: incident.summary.slice(0, 160), alternates: { canonical: `/incidents/${slug}` } };
}

// One page per recall, however people arrive (the list, a check, or a link from a chat or an AI assistant):
// what it is, what to do, which products, then the official record, the company's word, and the news.
export default async function IncidentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const incident = await getIncidentBySlug(slug);
  if (!incident) notFound();
  const source = publicOfficialSource(incident);
  const news = await getFoodSafetyNews().catch(() => ({ articles: [], unavailable: true }));
  const related = relatedNews(news.articles, incident);
  const hazard = classifyHazard(incident);
  const hazardText = incident.hazard?.trim() || incident.pathogen;
  // The FDA publishes recalling companies' own announcements as its recall notices.
  const companyAnnouncement = incident.authority === FDA && source.label === "Official source";

  return (
    <article className="page-shell py-6 sm:py-10">
      <Link href={`/?region=${incident.region}`} className="-ml-2 mb-4 inline-flex min-h-10 items-center gap-1 rounded-full px-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><ChevronLeft className="size-4" aria-hidden />All {incident.region} recalls</Link>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
        <div className="min-w-0">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-yeet px-2.5 py-0.5 text-xs font-bold text-white dark:text-background"><TriangleAlert className="size-3.5" aria-hidden />Active recall · {hazard.label}</span>
                <span className="text-muted-foreground">Updated <time dateTime={incident.updatedAt.toISOString()}>{formatRecallDate(incident.updatedAt)}</time> · {timeAgo(incident.updatedAt.valueOf())}</span>
              </p>
              <h1 className="mt-4 max-w-3xl text-[1.75rem] font-black leading-[1.12] tracking-[-0.03em] sm:text-4xl">{incident.title}</h1>
              {incident.summary ? <p className="mt-3 max-w-[65ch] leading-7 text-muted-foreground">{incident.summary}</p> : null}
            </div>
            <ShareButton label="Share this recall" title={`Recall: ${incident.title}`} text={`Heads up: ${incident.title} has been recalled (${hazard.label}).`} className="self-start" />
          </header>

          <section aria-labelledby="advice-heading" className="mt-7 rounded-xl bg-yeet-soft p-5 sm:p-6">
            <h2 id="advice-heading" className="flex items-center gap-2 text-lg font-black text-yeet"><TriangleAlert className="size-5" aria-hidden />What to do</h2>
            <p className="mt-2 max-w-[65ch] font-semibold leading-7">{incident.consumerAdvice}</p>
            <div className="mt-5 flex flex-col gap-3 border-t border-yeet/20 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-bold">Have one at home?</h3>
                <p className="text-sm leading-6">Check your pack’s codes and dates against this recall.</p>
              </div>
              <Button asChild variant="solid" className="h-11 shrink-0 rounded-full px-5 font-bold"><Link href="/search?mode=details">Check your pack<ArrowRight aria-hidden /></Link></Button>
            </div>
          </section>

          <div className="mt-10 space-y-10">
            <section aria-labelledby="products-heading">
              <div className="mb-4">
                <h2 id="products-heading" className="text-xl font-black tracking-tight">Which products</h2>
              </div>
              <IncidentTargets targets={incident.targets} />
            </section>
            {hazardText && hazardText !== incident.summary ? (
              <section aria-labelledby="detail-heading">
                <h2 id="detail-heading" className="text-xl font-black tracking-tight">More detail</h2>
                <p className="mt-3 max-w-[65ch] whitespace-pre-line text-sm leading-6 text-muted-foreground">{hazardText}</p>
              </section>
            ) : null}
            <NewsList heading="In the news" articles={related} unavailable={news.unavailable && !related.length} empty="No news stories about this recall yet." />
            <Link href={`/?region=${incident.region}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border px-5 text-sm font-bold hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">See all active {incident.region} recalls<ArrowRight className="size-4" aria-hidden /></Link>
          </div>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <section aria-labelledby="official-heading" className="rounded-xl border bg-card p-5 text-sm">
            <h2 id="official-heading" className="text-base font-black tracking-tight">Official information</h2>
            <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3">
              <dt className="text-muted-foreground">Authority</dt><dd className="font-semibold">{incident.authority}</dd>
              <dt className="text-muted-foreground">Published</dt><dd className="font-semibold tabular-nums">{formatRecallDate(incident.publishedAt)}</dd>
              <dt className="text-muted-foreground">Updated</dt><dd className="font-semibold tabular-nums">{formatRecallDate(incident.updatedAt)}, {timeFormat.format(incident.updatedAt)}</dd>
              <dt className="text-muted-foreground">Reference</dt><dd className="font-mono text-xs leading-5">{incident.sourceId}</dd>
            </dl>
            <Button asChild variant="solid" className="mt-5 h-11 w-full rounded-full font-bold"><a href={source.url} target="_blank" rel="noreferrer">{source.label === "Official source" ? "Read the official notice" : source.label}<ExternalLink aria-hidden /><span className="sr-only">, opens in a new tab</span></a></Button>
            {source.note ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{source.note}</p> : null}
            <div className="mt-5 border-t pt-4">
              <h3 className="font-bold">Company statement</h3>
              <p className="mt-1 leading-6 text-muted-foreground">
                {companyAnnouncement
                  ? "The FDA notice above is the company’s own announcement, published by the FDA."
                  : "No company statement on file for this recall. Follow the official notice above."}
              </p>
            </div>
          </section>
        </aside>
      </div>
    </article>
  );
}
