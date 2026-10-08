import { ArrowRight, ChevronDown, ScanBarcode, Search, SearchX } from "lucide-react";
import Link from "next/link";
import Form from "next/form";
import { Suspense, ViewTransition } from "react";

import { RegionalNews } from "@/components/news/regional-news";
import { listActivePublicIncidents } from "@/db/queries";
import { foodCategoryGroups, foodCategories, type FoodCategory } from "@/lib/incidents/browse";
import { normaliseText } from "@/lib/matching/normalise";
import { regionNames, type WarningRegion } from "@/lib/location";

import styles from "./warning-feed.module.css";

export type WarningParams = Record<string, string | string[] | undefined>;
type PublicIncident = Awaited<ReturnType<typeof listActivePublicIncidents>>[number];
type Filters = { region: WarningRegion; category?: FoodCategory; store?: string; q?: string; page?: number };
const PAGE_SIZE = 50;

function filterUrl(path: string, { region, category, store, q, page }: Filters) {
  const params = new URLSearchParams({ region });
  if (category) params.set("category", category);
  if (store) params.set("store", store);
  if (q) params.set("q", q);
  if (page && page > 1) params.set("page", String(page));
  return `${path}?${params}#warnings`;
}

function WarningRow({ incident }: { incident: PublicIncident }) {
  return <article className="border-b py-5 last:border-b-0 sm:py-6">
    <h3 className="text-lg font-bold leading-snug">
      <Link className="group flex items-start justify-between gap-4 rounded-sm underline-offset-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href={`/incidents/${incident.slug}`}>
        <span className="min-w-0 group-hover:underline group-focus-visible:underline">{incident.title}</span>
        <span className="grid size-11 shrink-0 place-items-center rounded-full border transition-colors group-hover:bg-secondary group-focus-visible:bg-secondary"><ArrowRight className="size-5" aria-hidden /></span>
      </Link>
    </h3>
    <p className="mt-2 max-w-[70ch] line-clamp-2 text-sm leading-6 text-muted-foreground">{incident.summary}</p>
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground">
      <span>{incident.authority}</span>
      <span className="tabular-nums">Updated <time dateTime={incident.updatedAt.toISOString()}>{incident.updatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })}</time></span>
      <span>{incident.categories.join(", ")}</span>
      {incident.stores.length ? <span>Named retailer: {incident.stores.join(", ")}</span> : null}
    </div>
  </article>;
}

export async function WarningFeed({ params, region, path }: { params: WarningParams; region: WarningRegion; path: "/" | "/incidents" }) {
  const [warnings] = await Promise.allSettled([listActivePublicIncidents(region)]);
  const regionalRows = warnings.status === "fulfilled" ? warnings.value.filter((row) => row.region === region) : [];
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const terms = query.split(/\s+/).map(normaliseText).filter(Boolean);
  const searchedRows = regionalRows.filter((row) => {
    const text = normaliseText(`${row.title} ${row.summary} ${row.stores.join(" ")}`);
    return terms.every((term) => text.includes(term));
  });
  const category = typeof params.category === "string" && foodCategories.includes(params.category as FoodCategory) ? params.category as FoodCategory : undefined;
  const store = typeof params.store === "string" && params.store ? params.store.slice(0, 120) : undefined;
  const rows = searchedRows.filter((row) => (!category || row.categories.includes(category)) && (!store || row.stores.includes(store)));
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const requestedPage = typeof params.page === "string" && /^\d{1,6}$/.test(params.page) ? Number(params.page) : 1;
  const page = Math.min(pageCount, Math.max(1, requestedPage));
  const offset = (page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(offset, offset + PAGE_SIZE);
  const filtered = Boolean(query || category || store);
  const officialUrl = region === "UK" ? "https://alerts.food.gov.uk/" : "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts";
  const categoryCounts = new Map<FoodCategory, number>();
  const stores = new Set<string>();
  for (const row of searchedRows) {
    if (!store || row.stores.includes(store)) for (const item of row.categories) categoryCounts.set(item, (categoryCounts.get(item) ?? 0) + 1);
    if (!category || row.categories.includes(category)) for (const item of row.stores) stores.add(item);
  }

  return <div id="warnings" className="scroll-mt-6">
    <div className="grid gap-9 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-10">
      <div className="min-w-0">
        <Form action={path} scroll={false} role="search" className="rounded-xl bg-card p-4 sm:p-5">
          <label htmlFor="warning-search" className="block text-lg font-bold tracking-tight">Search warnings</label>
          <p id="warning-search-hint" className="mt-1 text-sm leading-6 text-muted-foreground">Find a product, brand or retailer.</p>
          <input type="hidden" name="region" value={region} />
          <div className="mt-3 flex gap-2 sm:mt-4">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground sm:left-4" aria-hidden />
              <input key={query} id="warning-search" name="q" type="search" defaultValue={query} maxLength={120} placeholder="e.g. chocolate" aria-describedby="warning-search-hint" className="h-12 w-full min-w-0 rounded-md border bg-background pl-9 pr-3 text-base placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-14 sm:pl-11 sm:pr-4" />
            </div>
            <button type="submit" className="flex min-h-12 shrink-0 items-center justify-center rounded-md bg-foreground px-4 text-sm font-bold text-background transition-colors hover:bg-foreground/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-6">Search</button>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3 sm:mt-5">
            <div className="min-w-0 flex-1 basis-24">
              <label htmlFor="category-filter" className="mb-2 block text-sm font-bold">Food category</label>
              <div className="relative">
                <select key={category ?? "all"} id="category-filter" name="category" defaultValue={category ?? ""} className="min-h-11 w-full appearance-none rounded-md border bg-background pl-3 pr-9 text-sm hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  <option value="">All foods</option>
                  {foodCategoryGroups.map((group) => <optgroup key={group.label} label={group.label}>
                    {group.categories.map((item) => <option key={item} value={item}>{item} · {categoryCounts.get(item) ?? 0}</option>)}
                  </optgroup>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              </div>
            </div>
            {stores.size || store ? <div className="min-w-0 flex-1 basis-24">
              <label htmlFor="store-filter" className="mb-2 block text-sm font-bold">Named retailer</label>
              <div className="relative">
                <select key={store ?? "all"} id="store-filter" name="store" defaultValue={store ?? ""} className="min-h-11 w-full appearance-none rounded-md border bg-background pl-3 pr-9 text-sm hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  <option value="">All retailers</option>
                  {[...new Set([...stores, ...(store ? [store] : [])])].sort((a, b) => a.localeCompare(b)).map((item) => <option key={item}>{item}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              </div>
            </div> : null}
            <button type="submit" className="min-h-11 rounded-md border bg-background px-4 text-sm font-semibold transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Apply filters</button>
          </div>
        </Form>
        <p className="mt-3 flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground"><ScanBarcode className="mr-1 size-4" aria-hidden />Have the pack? <Link href="/search" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Check a barcode or label details</Link></p>

        <ViewTransition name="warning-context" default="none" update="warning-context" share="warning-context">
          <div className="mt-6 border-b pb-4 sm:mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-xl font-black sm:text-2xl">{category ?? `Current ${region} warnings`}</h2>
              <p aria-live="polite" aria-atomic="true" className="text-sm tabular-nums text-muted-foreground">{warnings.status === "fulfilled" ? `${rows.length.toLocaleString("en-GB")} ${rows.length === 1 ? "warning" : "warnings"}` : "Data unavailable"}</p>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{region} · Official notices from {region === "UK" ? <a href="https://alerts.food.gov.uk/" className="underline underline-offset-4 hover:text-foreground">the Food Standards Agency</a> : <><a href="https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts" className="underline underline-offset-4 hover:text-foreground">the FDA</a> and <a href="https://www.fsis.usda.gov/recalls" className="underline underline-offset-4 hover:text-foreground">USDA FSIS</a></>}</p>
          </div>
        </ViewTransition>
        {filtered ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{query ? `Results for "${query}". ` : ""}{store ? `Retailer: ${store}. ` : ""}<Link href={filterUrl(path, { region })} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Clear filters</Link></p> : null}
        {warnings.status === "rejected" ? <div role="status" className="py-8"><p className="font-bold">Warnings are temporarily unavailable.</p><p className="mt-2 max-w-[65ch] text-sm leading-6 text-muted-foreground">Please try again shortly, or check the <a className="underline underline-offset-4 hover:text-foreground" href={officialUrl}>official recall notices</a>.</p></div> : rows.length ? pageRows.map((incident) => <WarningRow key={incident.id} incident={incident} />) : <div className="flex items-start gap-3 py-7 sm:gap-4 sm:py-9">
          <SearchX className="mt-1 size-6 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="font-bold">{filtered ? "No current warnings match this selection." : "No current warnings to show."}</p>
            <p className="mt-2 max-w-[65ch] text-sm leading-6 text-muted-foreground">{filtered ? "Try a different product, brand or retailer, or clear the filters." : `No official notices are listed here for the ${regionNames[region]} right now.`}</p>
            <a href={officialUrl} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold underline underline-offset-4 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Read official recall notices<ArrowRight className="size-4" aria-hidden /></a>
            <p className="mt-1 max-w-[65ch] text-sm leading-6 text-muted-foreground">A missing warning does not mean food is safe to eat.</p>
          </div>
        </div>}
        {pageCount > 1 ? <nav aria-label="Warning pages" className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
          <p className="tabular-nums">Showing {offset + 1}–{offset + pageRows.length} of {rows.length} warnings</p>
          <div className="flex gap-4">
            {page > 1 ? <Link href={filterUrl(path, { region, category, store, q: query, page: page - 1 })} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">Previous warnings</Link> : null}
            {page < pageCount ? <Link href={filterUrl(path, { region, category, store, q: query, page: page + 1 })} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">Next warnings</Link> : null}
          </div>
        </nav> : null}
      </div>

      <aside className="space-y-8 border-t pt-7 lg:border-0 lg:pt-0">
        <section className={`${styles.scanPanel} rounded-xl bg-secondary p-5 sm:p-6`}>
          <div className={styles.scanPreview} aria-hidden>
            <ScanBarcode className="size-16 text-secondary-foreground" strokeWidth={1.25} />
            <span className={styles.scanLine} />
          </div>
          <h2 className="mt-5 text-2xl font-black leading-tight tracking-tight">Check the food<br className="hidden lg:block" /> in your hand</h2>
          <p className="mt-3 text-sm leading-6 text-secondary-foreground">Scan the barcode and add batch or date details to compare your pack with published warnings.</p>
          <Link href="/scan" className="mt-5 flex min-h-12 items-center justify-between gap-3 rounded-full bg-foreground px-5 text-sm font-bold text-background transition-colors hover:bg-foreground/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Check my food<ArrowRight className="size-4" aria-hidden /></Link>
          <Link href="/search?mode=details" className="mt-2 inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-secondary-foreground underline underline-offset-4 hover:decoration-2 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Enter label details instead</Link>
        </section>
        <Suspense key={region} fallback={<p role="status" className="min-h-24 text-sm text-muted-foreground">Loading food safety news…</p>}>
          <RegionalNews region={region} />
        </Suspense>
      </aside>
    </div>
  </div>;
}
