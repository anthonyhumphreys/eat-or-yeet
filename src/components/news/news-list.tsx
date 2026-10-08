import { ExternalLink } from "lucide-react";

import type { NewsArticle } from "@/lib/news/types";

export function NewsList({ articles, unavailable = false, heading = "Food safety in the news" }: { articles: NewsArticle[]; unavailable?: boolean; heading?: string }) {
  return (
    <section aria-label={heading}>
      <h2 className="text-lg font-bold tracking-tight">{heading}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Reporting from news publishers. Follow the official notice for product advice.</p>
      {articles.length ? <ul className="mt-4 divide-y border-t">
        {articles.map((article) => <li key={article.url} className="py-4">
          <p className="text-xs text-muted-foreground">{article.publisher} · <time dateTime={article.publishedAt}>{new Date(article.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })}</time></p>
          <a href={article.url} target="_blank" rel="noreferrer" className="mt-2 block rounded-sm text-sm font-bold leading-6 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">{article.title}<ExternalLink className="ml-1 inline size-3.5" aria-hidden /><span className="sr-only">, opens in a new tab</span></a>
        </li>)}
      </ul> : <p className="mt-4 text-sm leading-6 text-muted-foreground">{unavailable ? "News is temporarily unavailable. You can still read the official warnings." : "No recent reporting found for this selection."}</p>}
      {articles.length && unavailable ? <p className="text-xs leading-5 text-muted-foreground">Some publisher feeds are temporarily unavailable.</p> : null}
    </section>
  );
}
