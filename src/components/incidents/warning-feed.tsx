import { ArrowDown, ArrowRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { WarningExplorer, type ExplorerRow } from "@/components/incidents/warning-explorer";
import { RegionalNews } from "@/components/news/regional-news";
import { listActivePublicIncidents } from "@/db/queries";
import { isSuperCategory, productCategories, type ProductCategory } from "@/lib/incidents/browse";
import { classifyHazard, hazardKinds, type HazardKind } from "@/lib/incidents/hazard";
import { formatRecallDate, pickTopAlert, timeAgo } from "@/lib/incidents/recency";
import { type WarningRegion } from "@/lib/location";
import { getFoodSafetyNews } from "@/lib/news/feed";
import { newsForRegion } from "@/lib/news/related";

export type WarningParams = Record<string, string | string[] | undefined>;

const HOME_NEWS_LIMIT = 8;

function param(params: WarningParams, key: string) {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

export async function WarningFeed({ params, region, path }: { params: WarningParams; region: WarningRegion; path: "/" | "/incidents" }) {
  const [warnings] = await Promise.allSettled([listActivePublicIncidents(region)]);
  const regional = warnings.status === "fulfilled" ? warnings.value.filter((row) => row.region === region) : null;
  const rows: ExplorerRow[] | null = regional
    ? regional.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      updatedAt: row.updatedAt.valueOf(),
      categories: row.categories as ProductCategory[],
      superCategories: [...row.superCategories],
      stores: row.stores,
      hazard: classifyHazard(row),
    }))
    : null;
  // Drug enforcement reports cannot establish a current alert.
  const top = rows ? pickTopAlert(rows.filter((row) => row.superCategories.includes("Food"))) : undefined;
  const category = param(params, "category");
  const type = param(params, "type");
  const hazard = param(params, "hazard");
  const page = param(params, "page");

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
      <div className="min-w-0">
        {top ? <TopAlert row={top} summary={regional?.find((row) => row.id === top.id)?.summary} /> : null}
        <Suspense key={region} fallback={null}>
          <NewsButton region={region} />
        </Suspense>
        <div className="mt-6">
          <WarningExplorer
            rows={rows}
            region={region}
            path={path}
            initialPage={page && /^\d{1,3}$/.test(page) ? Math.max(1, Number(page)) : 1}
            initial={{
              q: (param(params, "q") ?? "").slice(0, 120),
              hazard: hazardKinds.includes(hazard as HazardKind) ? hazard as HazardKind : undefined,
              type: isSuperCategory(type) ? type : undefined,
              category: productCategories.includes(category as ProductCategory) ? category as ProductCategory : undefined,
              store: param(params, "store")?.slice(0, 120) || undefined,
            }}
          />
        </div>
      </div>
      {/* On wide screens the news runs down beside the list, level with the top alert. On phones it follows the list. */}
      <aside id="news" className="min-w-0 scroll-mt-4">
        <Suspense key={region} fallback={null}>
          <RegionalNews region={region} limit={HOME_NEWS_LIMIT} />
        </Suspense>
      </aside>
    </div>
  );
}

/** The one recall to see first: the newest food-poisoning recall this month, otherwise the newest recall. */
function TopAlert({ row, summary }: { row: ExplorerRow; summary?: string }) {
  return (
    <Link
      href={`/incidents/${row.slug}`}
      className="group block rounded-xl border bg-card p-4 transition-colors hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5"
    >
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-yeet px-2.5 py-0.5 text-xs font-bold text-white dark:text-background">
          <TriangleAlert className="size-3.5" aria-hidden />Top alert · {row.hazard.label}
        </span>
        <span className="text-xs text-muted-foreground">
          <time dateTime={new Date(row.updatedAt).toISOString()} className="tabular-nums">{formatRecallDate(row.updatedAt)}</time> · {timeAgo(row.updatedAt)}
        </span>
      </span>
      <span className="mt-2 block break-words text-lg font-black leading-snug tracking-tight sm:text-2xl">{row.title}</span>
      {summary ? <span className="mt-1.5 hidden max-w-[65ch] text-sm leading-6 text-muted-foreground sm:line-clamp-2">{summary}</span> : null}
      <span className="mt-3 hidden items-center gap-1 text-sm font-bold text-link sm:inline-flex">
        See full warning<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

/** Same shape as the top alert, so it reads as the second thing to look at. Hidden where the news is already beside the list. */
async function NewsButton({ region }: { region: WarningRegion }) {
  const feed = await getFoodSafetyNews().catch(() => null);
  const count = feed ? Math.min(newsForRegion(feed.articles, region).length, HOME_NEWS_LIMIT) : 0;
  if (!count) return null;
  return (
    <a
      href="#news"
      className="group mt-2 flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-5 lg:hidden"
    >
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-muted-foreground">In the news · {count} {count === 1 ? "story" : "stories"}</span>
        <span className="block font-bold">See the news</span>
      </span>
      <ArrowDown className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-y-0.5" aria-hidden />
    </a>
  );
}
