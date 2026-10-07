import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { RegionalNews } from "@/components/news/regional-news";
import { listActivePublicIncidents } from "@/db/queries";
import { foodCategoryGroups, foodCategories, type FoodCategory } from "@/lib/incidents/browse";
import { normaliseText } from "@/lib/matching/normalise";
import { type WarningRegion } from "@/lib/location";

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
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{incident.authority} · {incident.categories.join(", ")}</p>
        <h3 className="mt-2 text-lg font-bold leading-snug"><Link className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href={`/incidents/${incident.slug}`}>{incident.title}</Link></h3>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{incident.summary}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>Updated <time dateTime={incident.updatedAt.toISOString()}>{incident.updatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })}</time></span>
          {incident.stores.length ? <span>Named retailer: {incident.stores.join(", ")}</span> : null}
        </div>
      </div>
      <Link href={`/incidents/${incident.slug}`} aria-label={`View ${incident.title}`} className="mt-1 grid size-11 shrink-0 place-items-center rounded-full border hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><ArrowRight className="size-5" aria-hidden /></Link>
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
  const categoryCounts = new Map<FoodCategory, number>();
  const stores = new Set<string>();
  for (const row of searchedRows) {
    if (!store || row.stores.includes(store)) for (const item of row.categories) categoryCounts.set(item, (categoryCounts.get(item) ?? 0) + 1);
    if (!category || row.categories.includes(category)) for (const item of row.stores) stores.add(item);
  }

  return <div id="warnings" className="scroll-mt-6">
    <form action={path} role="search" className="max-w-3xl">
      <label htmlFor="warning-search" className="block text-base font-bold">Search warnings</label>
      <p id="warning-search-hint" className="mt-1 text-sm leading-6 text-muted-foreground">Find a product, brand, or retailer in published notices.</p>
      <input type="hidden" name="region" value={region} />
      {category ? <input type="hidden" name="category" value={category} /> : null}
      {store ? <input type="hidden" name="store" value={store} /> : null}
      <div className="mt-3 flex gap-2">
        <input key={query} id="warning-search" name="q" type="search" defaultValue={query} maxLength={120} placeholder="e.g. chocolate, Waitrose, sprouts" aria-describedby="warning-search-hint" className="h-12 min-w-0 flex-1 rounded-md border bg-background px-4 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
        <button type="submit" className="flex min-h-12 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-bold text-background focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><Search className="size-4" aria-hidden /><span>Search</span></button>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">Have the pack? <Link href="/search" className="inline-flex min-h-8 items-center font-semibold underline underline-offset-4">Check a barcode or label details</Link>.</p>
    </form>

    <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
        <form action={path} className="flex flex-wrap items-end gap-3 border-y py-4">
          <input type="hidden" name="region" value={region} />
          {query ? <input type="hidden" name="q" value={query} /> : null}
          <div className="min-w-0 flex-1 basis-44">
            <label htmlFor="category-filter" className="mb-2 block text-sm font-bold">Food category</label>
            <select key={category ?? "all"} id="category-filter" name="category" defaultValue={category ?? ""} className="min-h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">All foods</option>
              {foodCategoryGroups.map((group) => <optgroup key={group.label} label={group.label}>
                {group.categories.map((item) => <option key={item} value={item}>{item} · {categoryCounts.get(item) ?? 0}</option>)}
              </optgroup>)}
            </select>
          </div>
          {stores.size || store ? <div className="min-w-0 flex-1 basis-40">
            <label htmlFor="store-filter" className="mb-2 block text-sm font-bold">Named retailer</label>
            <select key={store ?? "all"} id="store-filter" name="store" defaultValue={store ?? ""} className="min-h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">All retailers</option>
              {[...new Set([...stores, ...(store ? [store] : [])])].sort((a, b) => a.localeCompare(b)).map((item) => <option key={item}>{item}</option>)}
            </select>
          </div> : null}
          <button type="submit" className="min-h-11 rounded-md bg-muted px-4 text-sm font-bold hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Apply filters</button>
        </form>

        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-3 border-b pb-4">
          <h2 className="text-2xl font-black">{category ?? `Current ${region} warnings`}</h2>
          <p className="text-sm text-muted-foreground">{warnings.status === "fulfilled" ? `${rows.length} ${rows.length === 1 ? "warning" : "warnings"}` : "Data unavailable"}</p>
        </div>
        {query || category || store ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{query ? `Results for "${query}". ` : ""}{store ? `Retailer: ${store}. ` : ""}<Link href={filterUrl(path, { region })} className="inline-flex min-h-9 items-center font-semibold underline underline-offset-4">Clear filters</Link></p> : null}
        {warnings.status === "rejected" ? <div role="status" className="py-8"><p className="font-bold">Warnings are temporarily unavailable.</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Please try again shortly, or check the <a className="underline underline-offset-4" href={region === "UK" ? "https://alerts.food.gov.uk/" : "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts"}>official recall notices</a>.</p></div> : rows.length ? pageRows.map((incident) => <WarningRow key={incident.id} incident={incident} />) : <div className="py-8"><p className="font-bold">No current warnings match this selection.</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Try a different search or clear the filters. A missing warning does not mean food is safe to eat.</p></div>}
        {pageCount > 1 ? <nav aria-label="Warning pages" className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
          <p>Showing {offset + 1}–{offset + pageRows.length} of {rows.length} warnings</p>
          <div className="flex gap-4">
            {page > 1 ? <Link href={filterUrl(path, { region, category, store, q: query, page: page - 1 })} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">Previous warnings</Link> : null}
            {page < pageCount ? <Link href={filterUrl(path, { region, category, store, q: query, page: page + 1 })} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">Next warnings</Link> : null}
          </div>
        </nav> : null}
      </div>

      <aside className="space-y-8 lg:border-l lg:pl-6">
        <section className="rounded-xl bg-secondary p-5">
          <h2 className="text-xl font-black">Check the food in your hand</h2>
          <p className="mt-2 text-sm leading-6 text-secondary-foreground">Scan the barcode and add batch or date details to compare your pack with published warnings.</p>
          <Link href="/scan" className="mt-4 flex min-h-11 items-center justify-between rounded-full bg-foreground px-4 text-sm font-bold text-background focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Check my food<ArrowRight className="size-4" aria-hidden /></Link>
          <Link href="/search?mode=details" className="mt-2 inline-flex min-h-10 items-center text-sm font-semibold underline underline-offset-4">Enter label details instead</Link>
        </section>
        <Suspense key={region} fallback={<p role="status" className="min-h-24 text-sm text-muted-foreground">Loading food safety news…</p>}>
          <RegionalNews region={region} />
        </Suspense>
      </aside>
    </div>
  </div>;
}
