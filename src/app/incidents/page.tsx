import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { listActivePublicIncidents } from "@/db/queries";
import { foodCategories, type FoodCategory } from "@/lib/incidents/browse";

export const metadata: Metadata = { title: "Browse food warnings", description: "Browse current official UK and US food-safety warnings by food category and named retailer." };
export const revalidate = 1800;

type Filters = { region?: "UK" | "US"; category?: FoodCategory; store?: string };
type PublicIncident = Awaited<ReturnType<typeof listActivePublicIncidents>>[number];

function filterUrl({ region, category, store }: Filters) {
  const params = new URLSearchParams();
  if (region) params.set("region", region);
  if (category) params.set("category", category);
  if (store) params.set("store", store);
  const query = params.toString();
  return query ? `/incidents?${query}` : "/incidents";
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return <Link href={href} aria-current={active ? "page" : undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${active ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-secondary"}`}>{children}</Link>;
}

function WarningRow({ incident }: { incident: PublicIncident }) {
  return (
    <article className="border-b py-5 last:border-b-0 sm:py-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{incident.region} · {incident.authority}</p>
          <h4 className="mt-2 text-lg font-bold leading-snug"><Link className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href={`/incidents/${incident.slug}`}>{incident.title}</Link></h4>
          <p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-6 text-muted-foreground">{incident.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>Updated {incident.updatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
            {incident.stores.length ? <span>Named retailer: {incident.stores.join(", ")}</span> : null}
          </div>
        </div>
        <Link href={`/incidents/${incident.slug}`} aria-label={`View ${incident.title}`} className="mt-1 grid size-11 shrink-0 place-items-center rounded-full border transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><ArrowRight className="size-5" aria-hidden /></Link>
      </div>
    </article>
  );
}

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, allRows] = await Promise.all([searchParams, listActivePublicIncidents()]);
  const region: Filters["region"] = params.region === "US" ? "US" : params.region === "UK" ? "UK" : undefined;
  const regionalRows = region ? allRows.filter((row) => row.region === region) : allRows;
  const availableCategories = new Set(regionalRows.flatMap((row) => row.categories));
  const availableStores = new Set(regionalRows.flatMap((row) => row.stores));
  const category = typeof params.category === "string" && availableCategories.has(params.category as FoodCategory) ? params.category as FoodCategory : undefined;
  const store = typeof params.store === "string" && availableStores.has(params.store) ? params.store : undefined;
  const categoryScope = store ? regionalRows.filter((row) => row.stores.includes(store)) : regionalRows;
  const storeScope = category ? regionalRows.filter((row) => row.categories.includes(category)) : regionalRows;
  const categoryCounts = new Map<FoodCategory, number>();
  const storeCounts = new Map<string, number>();
  for (const row of categoryScope) {
    for (const category of row.categories) categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }
  for (const row of storeScope) {
    for (const store of row.stores) storeCounts.set(store, (storeCounts.get(store) ?? 0) + 1);
  }
  const filters = { region, category, store };
  const rows = regionalRows.filter((row) => (!category || row.categories.includes(category)) && (!store || row.stores.includes(store)));
  const categories = foodCategories.filter((item) => categoryCounts.has(item));
  const stores = [...storeCounts.keys()].sort((a, b) => a.localeCompare(b));

  return (
    <div className="page-shell py-10 sm:py-14">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Browse food warnings</h1>
        <p className="mt-4 leading-7 text-muted-foreground">See which foods appear in current official UK and US warnings. Open a notice for the exact affected products, codes, and advice.</p>
      </div>

      <nav aria-label="Country" className="mt-8 flex flex-wrap gap-2">
        {([undefined, "UK", "US"] as const).map((item) => <FilterLink key={item ?? "all"} href={filterUrl({ region: item })} active={region === item}>{item ?? "All countries"}</FilterLink>)}
      </nav>

      <section aria-labelledby="category-heading" className="mt-9 border-t pt-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="category-heading" className="text-xl font-black">Browse by food</h2><p className="text-sm text-muted-foreground">Grouped from product names in official notices</p></div>
        <nav aria-label="Food category" className="mt-4 flex flex-wrap gap-2">
          <FilterLink href={filterUrl({ ...filters, category: undefined })} active={!category}>All foods <span className="opacity-70">{categoryScope.length}</span></FilterLink>
          {categories.map((item) => <FilterLink key={item} href={filterUrl({ ...filters, category: item })} active={category === item}>{item} <span className="opacity-70">{categoryCounts.get(item)}</span></FilterLink>)}
        </nav>
      </section>

      {stores.length ? (
        <section aria-labelledby="store-heading" className="mt-9 border-t pt-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="store-heading" className="text-xl font-black">Browse by store</h2><p className="text-sm text-muted-foreground">Only retailers explicitly named by an official source</p></div>
          <nav aria-label="Named retailer" className="mt-4 flex flex-wrap gap-2">
            <FilterLink href={filterUrl({ ...filters, store: undefined })} active={!store}>All stores</FilterLink>
            {stores.map((item) => <FilterLink key={item} href={filterUrl({ ...filters, store: item })} active={store === item}>{item} <span className="opacity-70">{storeCounts.get(item)}</span></FilterLink>)}
          </nav>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">A named store does not mean every product sold there is affected. Check the notice for product and batch details.</p>
        </section>
      ) : null}

      <div className="mt-12 flex flex-wrap items-baseline justify-between gap-3 border-b pb-4">
        <h2 className="text-2xl font-black">{category ?? "Current warnings"}</h2>
        <p className="text-sm text-muted-foreground">{rows.length} {rows.length === 1 ? "warning" : "warnings"}</p>
      </div>

      {rows.length ? categories.filter((item) => !category || category === item).map((item) => {
        const group = rows.filter((row) => row.categories.includes(item));
        if (!group.length) return null;
        return <section key={item} aria-label={`${item} warnings`} className="mt-7">
          <h3 className={category ? "sr-only" : "mb-1 text-lg font-black"}>{item} {!category ? <span className="ml-1 text-sm font-medium text-muted-foreground">{group.length}</span> : null}</h3>
          <div>{group.map((incident) => <WarningRow key={incident.id} incident={incident} />)}</div>
        </section>;
      }) : <div className="py-12 text-center"><p className="font-semibold">No current warnings match these filters.</p><p className="mt-2 text-sm text-muted-foreground">Try another food category or store, or show every warning.</p><Link href={filterUrl({ region })} className="mt-5 inline-flex min-h-11 items-center rounded-full bg-foreground px-5 text-sm font-bold text-background">Show all warnings</Link></div>}
    </div>
  );
}
