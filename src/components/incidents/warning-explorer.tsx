"use client";

import { ArrowRight, ChevronDown, ChevronRight, Search, SearchX, X } from "lucide-react";
import Link from "next/link";
import { startTransition, useEffect, useMemo, useRef, useState, ViewTransition, type ReactNode } from "react";

import { ShareButton } from "@/components/share-button";
import { foodCategoryGroups, type FoodCategory } from "@/lib/incidents/browse";
import { hazardKindNames, hazardKinds, type HazardKind, type HazardSummary } from "@/lib/incidents/hazard";
import { formatRecallDate, timeAgo } from "@/lib/incidents/recency";
import { normaliseText } from "@/lib/matching/normalise";
import { regionNames, type WarningRegion } from "@/lib/location";

export type ExplorerRow = {
  id: string;
  slug: string;
  title: string;
  updatedAt: number;
  categories: FoodCategory[];
  stores: string[];
  hazard: HazardSummary;
};

export type ExplorerFilters = { q: string; hazard?: HazardKind; category?: FoodCategory; store?: string };

const STEP = 40;
const foodTabs = foodCategoryGroups.flatMap((group) => group.categories);
const sourceNames: Record<WarningRegion, string> = { UK: "Food Standards Agency", US: "FDA and USDA FSIS" };
const officialUrls: Record<WarningRegion, string> = {
  UK: "https://alerts.food.gov.uk/",
  US: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts",
};
const tagTone: Record<HazardKind, string> = {
  pathogen: "bg-yeet-soft text-yeet",
  allergen: "bg-maybe-soft text-[color-mix(in_oklch,var(--maybe)_70%,var(--foreground))]",
  foreign: "bg-secondary text-secondary-foreground",
  spoilage: "bg-secondary text-secondary-foreground",
  other: "bg-muted text-muted-foreground",
};

export function filterUrl(path: string, region: WarningRegion, { q, hazard, category, store }: ExplorerFilters, page?: number) {
  const params = new URLSearchParams({ region });
  if (q) params.set("q", q);
  if (hazard) params.set("hazard", hazard);
  if (category) params.set("category", category);
  if (store) params.set("store", store);
  if (page && page > 1) params.set("page", String(page));
  return `${path}?${params}`;
}

function searchTerms(query: string) {
  return query.trim().split(/\s+/).map(normaliseText).filter(Boolean);
}

function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.trim().split(/\s+/).filter((word) => word.length > 1).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return text;
  return text.split(new RegExp(`(${words.join("|")})`, "gi")).map((part, index) => index % 2
    ? <mark key={index} className="rounded-[3px] bg-primary/25 px-px text-foreground">{part}</mark>
    : part);
}

function WarningRow({ row, query }: { row: ExplorerRow; query: string }) {
  const iso = new Date(row.updatedAt).toISOString();
  const date = formatRecallDate(row.updatedAt);
  // "x ago" depends on the viewer's clock, so a render either side of midnight may differ from the server's.
  const ago = timeAgo(row.updatedAt);
  return (
    <li className="border-b last:border-b-0">
      <Link href={`/incidents/${row.slug}`} className="group -mx-3 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 rounded-lg px-3 py-4 transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:grid-cols-[6.75rem_minmax(0,1fr)_auto] sm:gap-x-4">
        <span className="hidden pt-0.5 text-[13px] leading-5 sm:block">
          <time dateTime={iso} className="block font-semibold tabular-nums">{date}</time>
          <span suppressHydrationWarning className="block text-muted-foreground">{ago}</span>
        </span>
        <span className="min-w-0">
          <span className="block text-[0.9375rem] font-semibold leading-snug sm:text-base"><Highlight text={row.title} query={query} /></span>
          <span className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs leading-5 text-muted-foreground">
            <span className={`rounded-full px-2 font-semibold ${tagTone[row.hazard.kind]}`}><span className="sr-only">Hazard: </span>{row.hazard.label}</span>
            <span>{row.categories.join(", ")}</span>
            {row.stores.length ? <span>Sold at <Highlight text={row.stores.join(", ")} query={query} /></span> : null}
          </span>
          <span className="mt-1.5 block text-xs leading-5 text-muted-foreground sm:hidden">
            <time dateTime={iso} className="tabular-nums">{date}</time> · <span suppressHydrationWarning>{ago}</span>
          </span>
        </span>
        <ChevronRight className="mt-0.5 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
      </Link>
    </li>
  );
}

function Chip({ href, active, onSelect, children }: { href: string; active: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <a
      href={href}
      aria-current={active ? "true" : undefined}
      onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); onSelect(); }}
      className={`inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-muted-foreground"}`}
    >
      {children}
    </a>
  );
}

function FacetSelect({ id, label, value, onChange, children }: { id: string; label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-60">
      <label htmlFor={id} className="sr-only">{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={`min-h-10 w-full appearance-none truncate rounded-full border bg-background pl-3.5 pr-9 text-sm hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${value ? "border-foreground font-semibold" : ""}`}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </div>
  );
}

export function WarningExplorer({ rows, region, path, initial, initialPage = 1 }: { rows: ExplorerRow[] | null; region: WarningRegion; path: "/" | "/incidents"; initial: ExplorerFilters; initialPage?: number }) {
  const [filters, setFilters] = useState<ExplorerFilters>(initial);
  const [limit, setLimit] = useState(STEP * initialPage);
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const { q, hazard, category, store } = filters;

  const index = useMemo(() => (rows ?? []).map((row) => normaliseText(`${row.title} ${row.stores.join(" ")} ${row.hazard.label} ${row.categories.join(" ")}`)), [rows]);

  const view = useMemo(() => {
    const terms = searchTerms(q);
    const searched = (rows ?? []).filter((_, i) => terms.every((term) => index[i].includes(term)));
    const hazardCounts = new Map<HazardKind, number>();
    const categoryCounts = new Map<FoodCategory, number>();
    const stores = new Set<string>(store ? [store] : []);
    let hazardTotal = 0;
    let unnamedShop = 0;
    const results: ExplorerRow[] = [];
    for (const row of searched) {
      const inHazard = !hazard || row.hazard.kind === hazard;
      const inCategory = !category || row.categories.includes(category);
      const inStore = !store || row.stores.includes(store);
      if (inCategory && inStore) { hazardTotal++; hazardCounts.set(row.hazard.kind, (hazardCounts.get(row.hazard.kind) ?? 0) + 1); }
      if (inHazard && inStore) for (const item of row.categories) categoryCounts.set(item, (categoryCounts.get(item) ?? 0) + 1);
      if (inHazard && inCategory) for (const item of row.stores) stores.add(item);
      if (inHazard && inCategory && inStore) results.push(row);
      if (store && inHazard && inCategory && !row.stores.length) unnamedShop++;
    }
    return { results, hazardCounts, hazardTotal, categoryCounts, unnamedShop, stores: [...stores].sort((a, b) => a.localeCompare(b)) };
  }, [rows, index, q, hazard, category, store]);

  const { results } = view;
  const visible = results.slice(0, limit);
  const filtered = Boolean(q || hazard || category || store);
  const countLabel = `${results.length.toLocaleString("en-GB")} ${results.length === 1 ? "recall" : "recalls"}`;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const url = filterUrl(path, region, filters);
      if (`${location.pathname}${location.search}` !== url) window.history.replaceState(window.history.state, "", url);
      setAnnouncement(rows ? countLabel : "");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters, path, region, rows, countLabel]);

  useEffect(() => {
    // Keep the selected food type visible in the horizontally scrolling tab row without moving the page.
    const row = chipsRef.current;
    const chip = row?.querySelector<HTMLElement>("[aria-current]");
    if (row && chip && (chip.offsetLeft < row.scrollLeft || chip.offsetLeft + chip.offsetWidth > row.scrollLeft + row.clientWidth)) row.scrollLeft = chip.offsetLeft - 16;
  }, [category]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || target.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function update(next: Partial<ExplorerFilters>, animate = true) {
    const apply = () => { setFilters((current) => ({ ...current, ...next })); setLimit(STEP); };
    if (animate) startTransition(apply);
    else apply();
  }

  const removable: Array<[string, Partial<ExplorerFilters>]> = [
    ...(q ? [[`“${q}”`, { q: "" }] as [string, Partial<ExplorerFilters>]] : []),
    ...(hazard ? [[hazardKindNames[hazard], { hazard: undefined }] as [string, Partial<ExplorerFilters>]] : []),
    ...(category ? [[category, { category: undefined }] as [string, Partial<ExplorerFilters>]] : []),
    ...(store ? [[store, { store: undefined }] as [string, Partial<ExplorerFilters>]] : []),
  ];

  return (
    <div id="warnings" className="min-w-0 scroll-mt-4">
      <div ref={chipsRef} className="relative -mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0" role="group" aria-label="Filter by food type">
        <div className="flex gap-2 sm:flex-wrap">
          <Chip href={filterUrl(path, region, { ...filters, category: undefined })} active={!category} onSelect={() => update({ category: undefined })}>
            All foods
          </Chip>
          {/* Every food type is always shown, so the tabs stay put while people search. */}
          {foodTabs.map((item) => {
            const count = view.categoryCounts.get(item) ?? 0;
            return (
              <Chip key={item} href={filterUrl(path, region, { ...filters, category: item })} active={category === item} onSelect={() => update({ category: category === item ? undefined : item })}>
                {item} <span className="tabular-nums">{count.toLocaleString("en-GB")}</span>
              </Chip>
            );
          })}
        </div>
      </div>

      <form role="search" action={path} className="mt-3" onSubmit={(event) => { event.preventDefault(); inputRef.current?.blur(); }}>
        <input type="hidden" name="region" value={region} />
        <label htmlFor="warning-search" className="sr-only">Search {region} recalls</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            id="warning-search"
            name="q"
            type="search"
            value={q}
            maxLength={120}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            onChange={(event) => update({ q: event.target.value }, false)}
            onKeyDown={(event) => { if (event.key === "Escape" && q) { event.preventDefault(); update({ q: "" }, false); } }}
            placeholder="Product, brand, allergen or shop"
            className="h-12 w-full min-w-0 rounded-xl border bg-background pl-12 pr-14 text-base shadow-[0_1px_2px_rgb(29_26_22/6%)] placeholder:text-muted-foreground hover:border-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
          />
          {q ? (
            <button type="button" aria-label="Clear search" onClick={() => { update({ q: "" }, false); inputRef.current?.focus(); }} className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><X className="size-4" aria-hidden /></button>
          ) : (
            <kbd aria-hidden className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rounded-md border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground sm:block">/</kbd>
          )}
        </div>
      </form>

      <div className="mt-3 flex gap-2">
        <FacetSelect id="hazard-filter" label="Hazard" value={hazard ?? ""} onChange={(value) => update({ hazard: (value || undefined) as HazardKind | undefined })}>
          <option value="">All hazards ({view.hazardTotal.toLocaleString("en-GB")})</option>
          {hazardKinds.map((kind) => {
            const count = view.hazardCounts.get(kind) ?? 0;
            if (!count && hazard !== kind) return null;
            return <option key={kind} value={kind}>{hazardKindNames[kind]} ({count.toLocaleString("en-GB")})</option>;
          })}
        </FacetSelect>
        {view.stores.length ? (
          <FacetSelect id="store-filter" label="Shop" value={store ?? ""} onChange={(value) => update({ store: value || undefined })}>
            <option value="">All shops</option>
            {view.stores.map((item) => <option key={item}>{item}</option>)}
          </FacetSelect>
        ) : null}
      </div>

      <ViewTransition name="warning-context" default="none" update="warning-context" share="warning-context">
        <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b pb-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight">
              {rows ? <><span className="tabular-nums">{countLabel}</span>{filtered ? " found" : ` in the ${region}`}</> : `${region} recalls`}
            </h2>
            <p className="text-xs text-muted-foreground">Newest first · {sourceNames[region]}</p>
            {store && view.unnamedShop ? (
              // A shop filter must never look like an all-clear: most notices do not say where a product was sold.
              <p className="mt-1 max-w-[60ch] text-xs leading-5 text-muted-foreground">
                {view.unnamedShop.toLocaleString("en-GB")} more {view.unnamedShop === 1 ? "recall does" : "recalls do"} not name a shop and could still apply.{" "}
                <button type="button" onClick={() => update({ store: undefined })} className="rounded-sm font-semibold text-link underline underline-offset-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Show all shops</button>
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            {filtered ? (
              <button type="button" onClick={() => update({ q: "", hazard: undefined, category: undefined, store: undefined })} className="min-h-10 rounded-sm text-sm font-semibold underline underline-offset-4 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Clear all</button>
            ) : null}
            {rows ? <ShareButton label="Share this list" title={`${region} food recalls`} text={`${region} food recalls right now, from the official sources.`} url={filterUrl(path, region, filters)} /> : null}
          </div>
        </div>
      </ViewTransition>
      <p aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</p>

      {!rows ? (
        <div role="status" className="py-10">
          <p className="font-bold">Warnings are temporarily unavailable.</p>
          <p className="mt-2 max-w-[60ch] text-sm leading-6 text-muted-foreground">Try again shortly, or read the <a className="font-semibold underline underline-offset-4 hover:text-foreground" href={officialUrls[region]}>official recall notices</a>.</p>
        </div>
      ) : results.length ? (
        <ul>
          {visible.map((row) => (
            <ViewTransition key={row.id} name={`warning-${row.id}`} default="none" share="warning-row" update="warning-row" enter="warning-enter" exit="warning-exit">
              <WarningRow row={row} query={q} />
            </ViewTransition>
          ))}
        </ul>
      ) : (
        <div className="flex items-start gap-4 py-10">
          <SearchX className="mt-0.5 size-6 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="font-bold">{filtered ? "No current warnings match." : `No current warnings for the ${regionNames[region]}.`}</p>
            {removable.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {removable.map(([label, change]) => (
                  <button key={label} type="button" onClick={() => update(change)} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                    <X className="size-3.5" aria-hidden /><span className="sr-only">Remove </span>{label}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="mt-4 max-w-[60ch] text-sm leading-6 text-muted-foreground">No match here does not mean a food is safe. Have the pack? <Link href="/search" className="font-semibold text-link underline underline-offset-4">Check its codes and dates</Link>.</p>
          </div>
        </div>
      )}

      {results.length > visible.length ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-sm tabular-nums text-muted-foreground">Showing {visible.length.toLocaleString("en-GB")} of {results.length.toLocaleString("en-GB")}</p>
          <a
            href={filterUrl(path, region, filters, Math.floor(limit / STEP) + 1)}
            onClick={(event) => { event.preventDefault(); startTransition(() => setLimit((current) => current + STEP)); }}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border px-5 text-sm font-bold hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Show {Math.min(STEP, results.length - visible.length)} more<ArrowRight className="size-4 rotate-90" aria-hidden />
          </a>
        </div>
      ) : null}
    </div>
  );
}
