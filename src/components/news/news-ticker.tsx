"use client";

import { ChevronLeft, ChevronRight, ExternalLink, Pause, Play } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useLocation } from "@/components/location-provider";
import { newsForRegion } from "@/lib/news/related";
import type { NewsFeed } from "@/lib/news/types";
import type { WarningRegion } from "@/lib/location";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function NewsTicker({ feed, initialRegion }: { feed: NewsFeed; initialRegion: WarningRegion }) {
  const { region: selectedRegion } = useLocation();
  // A streamed ticker may hydrate after the visitor has already changed countries.
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const region = hydrated ? selectedRegion : initialRegion;
  // A region change remounts the controls so its newest article always comes first.
  return <Ticker key={region} feed={feed} region={region} />;
}

function Ticker({ feed, region }: { feed: NewsFeed; region: "UK" | "US" }) {
  const articles = newsForRegion(feed.articles, region).slice(0, 5);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const article = articles[index % (articles.length || 1)];

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (paused || interacting || reducedMotion || articles.length < 2) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % articles.length), 10_000);
    return () => window.clearInterval(timer);
  }, [paused, interacting, reducedMotion, articles.length]);

  const controlClass = "grid size-11 place-items-center rounded-full hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
  return (
    <section aria-label="Latest food safety news" className="border-b bg-muted" onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)} onFocusCapture={() => setInteracting(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false); }}>
      <div className="page-shell flex min-h-12 items-center gap-3 py-2">
        <span className="hidden shrink-0 text-xs font-bold sm:block">Latest news</span>
        {article ? <div className="min-w-0 flex-1">
          <a className="relative flex min-w-0 items-center gap-2 rounded-sm text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href={article.url} target="_blank" rel="noreferrer"><span className="truncate">{article.title}</span><ExternalLink className="hidden size-3 shrink-0 sm:block" aria-hidden /><span className="sr-only">, opens in a new tab</span></a>
          <p className="truncate text-xs text-muted-foreground">{article.publisher} · <time dateTime={article.publishedAt}>{new Date(article.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })}</time></p>
        </div> : <p className="text-xs leading-5 text-muted-foreground">{feed.unavailable ? "News temporarily unavailable" : "No recent food safety headlines"}</p>}
        {articles.length > 1 ? <div className="flex shrink-0 items-center">
          <button type="button" className={controlClass} aria-label="Previous headline" onClick={() => setIndex((current) => (current - 1 + articles.length) % articles.length)}><ChevronLeft className="size-4" aria-hidden /></button>
          <button type="button" className={controlClass} aria-label={paused ? "Play headlines" : "Pause headlines"} onClick={() => setPaused((current) => !current)}>{paused ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}</button>
          <button type="button" className={controlClass} aria-label="Next headline" onClick={() => setIndex((current) => (current + 1) % articles.length)}><ChevronRight className="size-4" aria-hidden /></button>
        </div> : null}
      </div>
    </section>
  );
}
