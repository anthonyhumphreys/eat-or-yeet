import { ExternalLink, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getIncidentBySlug } from "@/db/queries";
import { IncidentTargets } from "@/components/incidents/incident-targets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NewsList } from "@/components/news/news-list";
import { publicOfficialSource } from "@/lib/incidents/public-source";
import { getFoodSafetyNews } from "@/lib/news/feed";
import { relatedNews } from "@/lib/news/related";

export const revalidate = 1800;

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
  const news = await getFoodSafetyNews();
  return (
    <article className="page-shell py-10 sm:py-14">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
      <div className="rounded-xl bg-yeet-soft p-6 sm:p-9">
        <div className="flex items-center justify-between"><Badge className="bg-yeet text-white">ACTIVE WARNING</Badge><TriangleAlert className="size-8 text-yeet" aria-hidden /></div>
        <p className="mt-8 text-5xl font-black leading-none tracking-[-0.04em] text-yeet sm:text-7xl">YEET</p>
        <h1 className="mt-6 max-w-3xl text-2xl font-black leading-tight sm:text-3xl">{incident.title}</h1>
      </div>
        <div className="mt-7 space-y-8">
          <section><h2 className="text-xl font-black">What happened</h2><p className="mt-3 leading-7 text-muted-foreground">{incident.summary}</p></section>
          <section className="rounded-xl bg-yeet-soft p-5"><h2 className="text-sm font-black uppercase tracking-wide text-yeet">Official consumer advice</h2><p className="mt-3 font-semibold leading-7">{incident.consumerAdvice}</p></section>
          <section><h2 className="mb-4 text-xl font-black">Affected products and codes</h2><IncidentTargets targets={incident.targets} /></section>
        </div>
      </div>
      <div className="space-y-8">
        <aside className="h-fit rounded-xl bg-card p-5 text-sm">
          <dl className="space-y-4"><div><dt className="text-muted-foreground">Authority</dt><dd className="mt-1 font-semibold">{incident.authority}</dd></div><div><dt className="text-muted-foreground">Hazard</dt><dd className="mt-1 font-semibold">{incident.pathogen ?? incident.hazard ?? "See source"}</dd></div><div><dt className="text-muted-foreground">Published</dt><dd className="mt-1 font-semibold">{incident.publishedAt.toLocaleDateString()}</dd></div><div><dt className="text-muted-foreground">Last updated</dt><dd className="mt-1 font-semibold">{incident.updatedAt.toLocaleString()}</dd></div><div><dt className="text-muted-foreground">Source ID</dt><dd className="mt-1 font-mono text-xs">{incident.sourceId}</dd></div></dl>
          <Button asChild className="mt-6 w-full rounded-full"><a href={source.url} target="_blank" rel="noreferrer">{source.label}<ExternalLink aria-hidden /></a></Button>
          {source.note ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{source.note}</p> : null}
        </aside>
        <NewsList heading="Related news" articles={relatedNews(news.articles, incident)} unavailable={news.unavailable} />
      </div>
      </div>
    </article>
  );
}
