"use client";

import { ArrowRight, ChevronDown, ChevronRight, Search, SearchX, X } from "lucide-react";
import Link from "next/link";
import { startTransition, useEffect, useMemo, useRef, useState, ViewTransition, type ReactNode } from "react";

import { useBrowsePage } from "./use-browse-page";
import type { BrowsePage } from "@/lib/incidents/browse-view";
import { BROWSE_POSITION_KEY, RecallLink, rememberBrowsePosition } from "./recall-link";
import { BROWSE_PAGE_SIZE, browseReturnUrl, filterUrl, type ExplorerFilters } from "@/lib/incidents/browse-navigation";
import { foodCategories, productCategories, superCategories, type ProductCategory, type SuperCategory } from "@/lib/incidents/browse";
import { hazardKindNames, type HazardKind, type HazardSummary } from "@/lib/incidents/hazard";
import { recallName, recallReason } from "@/lib/incidents/product-name";
import { formatRecallDate, timeAgo } from "@/lib/incidents/recency";
import { warningSearchMatchesText, warningSearchTerms, warningSearchText } from "@/lib/incidents/warning-search";
import { regionNames, type WarningRegion } from "@/lib/location";

export type ExplorerRow = {
  id: string;
  slug: string;
  title: string;
  updatedAt: number;
  categories: ProductCategory[];
  superCategories: SuperCategory[];
  stores: string[];
  hazard: HazardSummary;
  searchText?: string;
};

export type { ExplorerFilters } from "@/lib/incidents/browse-navigation";

const STEP = BROWSE_PAGE_SIZE;
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


function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.trim().split(/\s+/).filter((word) => word.length > 1).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return text;
  return text.split(new RegExp(`(${words.join("|")})`, "gi")).map((part, index) => index % 2
    ? <mark key={index} className="rounded-[3px] bg-primary/25 px-px text-foreground">{part}</mark>
    : part);
}

function WarningRow({ row, query, returnTo }: { row: ExplorerRow; query: string; returnTo: string }) {
  const iso = new Date(row.updatedAt).toISOString();
  const date = formatRecallDate(row.updatedAt);
  // "x ago" depends on the viewer's clock, so a render either side of midnight may differ from the server's.
  const ago = timeAgo(row.updatedAt);
  const name = recallName(row);
  return (
    <li className="border-b last:border-b-0">
      <RecallLink slug={row.slug} returnTo={returnTo} className="group -mx-3 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 rounded-lg px-3 py-4 transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:grid-cols-[6.75rem_minmax(0,1fr)_auto] sm:gap-x-4">
        <span className="hidden pt-0.5 text-[13px] leading-5 sm:block">
          <time dateTime={iso} className="block font-semibold tabular-nums">{date}</time>
          <span suppressHydrationWarning className="block text-muted-foreground">{ago}</span>
        </span>
        <span className="min-w-0">
          <span className="block text-[0.9375rem] leading-snug sm:text-base"><strong className="font-bold"><Highlight text={name.product} query={query} /></strong><span className="text-muted-foreground">: <Highlight text={recallReason(name, row.hazard)} query={query} /></span></span>
          {name.company ? <span className="mt-0.5 block text-[13px] leading-5 text-muted-foreground"><span className="sr-only">Recalled by </span><Highlight text={name.company} query={query} /></span> : null}
          <span className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs leading-5 text-muted-foreground">
            <span className={`rounded-full px-2 font-semibold ${tagTone[row.hazard.kind]}`}><span className="sr-only">Hazard: </span>{row.hazard.label}</span>
            <span>{row.categories.join(", ")}</span>
            {row.superCategories.includes("Medical") ? <span>Published report · current status unverified</span> : null}
            {row.stores.length ? <span>Sold at <Highlight text={row.stores.join(", ")} query={query} /></span> : null}
          </span>
          <span className="mt-1.5 block text-xs leading-5 text-muted-foreground sm:hidden">
            <time dateTime={iso} className="tabular-nums">{date}</time> · <span suppressHydrationWarning>{ago}</span>
          </span>
        </span>
        <ChevronRight className="mt-0.5 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
      </RecallLink>
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

function currentBrowseState(initial: ExplorerFilters, initialPage: number) {
  const url = typeof window === "undefined" ? null : browseReturnUrl(`${window.location.pathname}${window.location.search}`);
  if (!url) return { filters: initial, page: initialPage };
  const params = new URL(url, "https://browse.invalid").searchParams;
  return { filters: {
    q: params.get("q") ?? "",
    hazard: (params.get("hazard") || undefined) as HazardKind | undefined,
    type: (params.get("type") || undefined) as SuperCategory | undefined,
    category: (params.get("category") || undefined) as ProductCategory | undefined,
    store: params.get("store") || undefined,
  }, page: Number(params.get("page") ?? 1) };
}

export function WarningExplorer({ rows, region, path, initial, initialPage = 1, serverPage }: { rows: ExplorerRow[] | null; region: WarningRegion; path: "/" | "/incidents"; initial: ExplorerFilters; initialPage?: number; serverPage?: BrowsePage }) {
  const [filters, setFilters] = useState<ExplorerFilters>(() => currentBrowseState(initial, initialPage).filters);
  const [limit, setLimit] = useState(() => {
    const requested = STEP * currentBrowseState(initial, initialPage).page;
    return serverPage ? Math.min(requested,Math.max(STEP,Math.ceil(serverPage.total/STEP)*STEP)) : requested;
  });
  const indexed = useBrowsePage(serverPage,region,filters,limit,setLimit);
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const typesRef = useRef<HTMLDivElement>(null);
  const { q, hazard, type, category, store } = filters;

  const index = useMemo(() => (rows ?? []).map(warningSearchText), [rows]);

  // Tabs come from the region's recalls, not the search, so they stay put while people type.
  const tabs = useMemo(() => {
    if (indexed.page) return {
      types:superCategories.filter(item=>indexed.page!.facets.tabs.includes(item)),
      categories:productCategories.filter(item=>indexed.page!.facets.categoryTabs.includes(item) || item===category || ((!type || type==="Food") && (foodCategories as readonly string[]).includes(item))),
    };
    const types = new Set<SuperCategory>();
    const categories = new Set<ProductCategory>();
    for (const row of rows ?? []) {
      row.superCategories.forEach((item) => types.add(item));
      if (!type || row.superCategories.includes(type)) row.categories.forEach((item) => categories.add(item));
    }
    return {
      types: superCategories.filter((item) => types.has(item)),
      // Every food type stays listed under food; other categories only appear once they have recalls.
      categories: productCategories.filter((item) => categories.has(item) || item === category
        || ((!type || type === "Food") && (foodCategories as readonly string[]).includes(item))),
    };
  }, [rows, type, category, indexed.page]);

  const view = useMemo(() => {
    if (indexed.page) {
      const facets=indexed.page.facets;
      return {results:indexed.page.rows,hazardCounts:new Map(facets.hazards.map(row=>[row.key as HazardKind,row.count])),hazardTotal:facets.hazards.reduce((sum,row)=>sum+row.count,0),typeCounts:new Map(facets.types.map(row=>[row.key as SuperCategory,row.count])),typeTotal:facets.typeTotal,categoryCounts:new Map(facets.categories.map(row=>[row.key as ProductCategory,row.count])),stores:[...new Set([...(store?[store]:[]),...facets.stores])].sort((a,b)=>a.localeCompare(b))};
    }
    const terms = warningSearchTerms(q);
    const searched = (rows ?? []).filter((_, i) => warningSearchMatchesText(index[i], terms));
    const hazardCounts = new Map<HazardKind, number>();
    const typeCounts = new Map<SuperCategory, number>();
    const categoryCounts = new Map<ProductCategory, number>();
    const stores = new Set<string>(store ? [store] : []);
    let hazardTotal = 0;
    let typeTotal = 0;
    const results: ExplorerRow[] = [];
    for (const row of searched) {
      const inHazard = !hazard || row.hazard.kind === hazard;
      const inType = !type || row.superCategories.includes(type);
      const inCategory = !category || row.categories.includes(category);
      const inStore = !store || row.stores.includes(store);
      if (inType && inCategory && inStore) { hazardTotal++; hazardCounts.set(row.hazard.kind, (hazardCounts.get(row.hazard.kind) ?? 0) + 1); }
      if (inHazard && inStore) { typeTotal++; for (const item of row.superCategories) typeCounts.set(item, (typeCounts.get(item) ?? 0) + 1); }
      if (inHazard && inType && inStore) for (const item of row.categories) categoryCounts.set(item, (categoryCounts.get(item) ?? 0) + 1);
      if (inHazard && inType && inCategory) for (const item of row.stores) stores.add(item);
      if (inHazard && inType && inCategory && inStore) results.push(row);
    }
    return { results, hazardCounts, hazardTotal, typeCounts, typeTotal, categoryCounts, stores: [...stores].sort((a, b) => a.localeCompare(b)) };
  }, [rows, index, q, hazard, type, category, store, indexed.page]);

  const { results } = view;
  const total = indexed.page?.total ?? results.length;
  const visible = results.slice(0, limit);
  const page = Math.max(1, Math.ceil((indexed.page ? limit : Math.min(limit, results.length)) / STEP));
  const returnTo = filterUrl(path, region, filters, page);
  const filtered = Boolean(q || hazard || type || category || store);
  const countLabel = `${total.toLocaleString("en-GB")} ${total === 1 ? "recall" : "recalls"}`;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const url = returnTo;
      if (`${location.pathname}${location.search}` !== url) window.history.replaceState(window.history.state, "", url);
      setAnnouncement(rows ? countLabel : "");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [returnTo, rows, countLabel]);

  useEffect(() => {
    if (!rows) return;
    let frame = 0;
    try {
      const raw = sessionStorage.getItem(BROWSE_POSITION_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved?.url === returnTo && Number.isFinite(saved.y) && saved.y >= 0) {
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => {
            const link = typeof saved.slug === "string" ? document.querySelector<HTMLElement>(`[data-recall-slug="${CSS.escape(saved.slug)}"]`) : null;
            if (saved.slug && !link && indexed.page?.nextCursor && indexed.page.rows.length < limit) return;
            link?.focus({ preventScroll: true });
            window.scrollTo({ top: saved.y, behavior: "instant" });
            sessionStorage.removeItem(BROWSE_POSITION_KEY);
          });
        });
      }
    } catch { /* Ignore unavailable storage or invalid stale state. */ }
    const save = () => rememberBrowsePosition(returnTo, (document.activeElement as HTMLElement | null)?.dataset.recallSlug);
    window.addEventListener("pagehide", save);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("pagehide", save); };
  }, [returnTo, rows, indexed.page, limit]);

  useEffect(() => {
    // Keep the selected tabs visible in the horizontally scrolling rows without moving the page.
    for (const row of [typesRef.current, chipsRef.current]) {
      const chip = row?.querySelector<HTMLElement>("[aria-current]");
      if (row && chip && (chip.offsetLeft < row.scrollLeft || chip.offsetLeft + chip.offsetWidth > row.scrollLeft + row.clientWidth)) row.scrollLeft = chip.offsetLeft - 16;
    }
  }, [type, category]);

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
    ...(type ? [[type, { type: undefined, category: undefined }] as [string, Partial<ExplorerFilters>]] : []),
    ...(category ? [[category, { category: undefined }] as [string, Partial<ExplorerFilters>]] : []),
    ...(store ? [[store, { store: undefined }] as [string, Partial<ExplorerFilters>]] : []),
  ];

  return (
    <div id="warnings" aria-busy={indexed.loading} className="min-w-0 scroll-mt-4">
      {tabs.types.length > 1 ? (
        <div ref={typesRef} className="relative -mx-4 mb-3 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0" role="group" aria-label="Filter by kind of product">
          <div className="flex gap-2 border-b pb-3 sm:flex-wrap">
            <Chip href={filterUrl(path, region, { ...filters, type: undefined, category: undefined })} active={!type} onSelect={() => update({ type: undefined, category: undefined })}>
              Everything <span className="tabular-nums">{view.typeTotal.toLocaleString("en-GB")}</span>
            </Chip>
            {tabs.types.map((item) => (
              <Chip key={item} href={filterUrl(path, region, { ...filters, type: item, category: undefined })} active={type === item} onSelect={() => update({ type: type === item ? undefined : item, category: undefined })}>
                {item} <span className="tabular-nums">{(view.typeCounts.get(item) ?? 0).toLocaleString("en-GB")}</span>
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
      <div ref={chipsRef} className="relative -mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0" role="group" aria-label="Filter by category">
        <div className="flex gap-2 sm:flex-wrap">
          <Chip href={filterUrl(path, region, { ...filters, category: undefined })} active={!category} onSelect={() => update({ category: undefined })}>
            {type ? `All ${type.toLowerCase()}` : "All categories"}
          </Chip>
          {tabs.categories.map((item) => {
            const count = view.categoryCounts.get(item) ?? 0;
            // Empty categories are hidden, except the one already chosen so it can be cleared.
            if (count === 0 && category !== item) return null;
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

      {/* No hazard filter: each row's tag names the hazard. Old ?hazard= links still filter and can be cleared. */}
      {view.stores.length ? (
        <div className="mt-3 flex gap-2">
          <FacetSelect id="store-filter" label="Shop" value={store ?? ""} onChange={(value) => update({ store: value || undefined })}>
            <option value="">All shops</option>
            {view.stores.map((item) => <option key={item}>{item}</option>)}
          </FacetSelect>
        </div>
      ) : null}

      <ViewTransition name="warning-context" default="none" update="warning-context" share="warning-context">
        <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b pb-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight">
              {rows ? <><span className="tabular-nums">{countLabel}</span>{filtered ? " found" : ` in the ${region}`}</> : `${region} recalls`}
            </h2>
            <p className="text-xs text-muted-foreground">Newest first · {sourceNames[region]}</p>
          </div>
          <div className="flex items-center gap-3">
            {filtered ? (
              <button type="button" onClick={() => update({ q: "", hazard: undefined, type: undefined, category: undefined, store: undefined })} className="min-h-10 rounded-sm text-sm font-semibold underline underline-offset-4 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Clear all</button>
            ) : null}
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
            <ViewTransition key={row.id} name={`warning-${Array.from(new TextEncoder().encode(row.id), value => value.toString(16).padStart(2,"0")).join("")}`} default="none" share="warning-row" update="warning-row" enter="warning-enter" exit="warning-exit">
              <WarningRow row={row} query={q} returnTo={returnTo} />
            </ViewTransition>
          ))}
        </ul>
      ) : (
        <div className="flex items-start gap-4 py-10">
          <SearchX className="mt-0.5 size-6 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="font-bold">{filtered ? "No recall reports match." : `No recall reports for the ${regionNames[region]}.`}</p>
            {removable.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {removable.map(([label, change]) => (
                  <button key={label} type="button" onClick={() => update(change)} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                    <X className="size-3.5" aria-hidden /><span className="sr-only">Remove </span>{label}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="mt-4 max-w-[60ch] text-sm leading-6 text-muted-foreground">No match here does not mean a product is safe.{type === "Medical" ? " For a medicine, check the latest official information or ask a pharmacist." : !type || type === "Food" || type === "Baby" ? <> Have a food pack? <Link href="/search" className="font-semibold text-link underline underline-offset-4">Check its codes and dates</Link>.</> : null}</p>
          </div>
        </div>
      )}

      {indexed.notice ? <p role="status" className="mt-3 text-sm text-muted-foreground">{indexed.notice}</p> : null}
      {indexed.error ? <p role="alert" className="mt-4 text-sm">{indexed.error} <button type="button" onClick={indexed.retry} className="min-h-10 underline">Retry</button></p> : null}
      {indexed.loading ? <p role="status" className="mt-3 text-sm text-muted-foreground">Updating recalls…</p> : null}
      {total > visible.length ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-sm tabular-nums text-muted-foreground">Showing {visible.length.toLocaleString("en-GB")} of {total.toLocaleString("en-GB")}</p>
          <a
            href={filterUrl(path, region, filters, Math.floor(limit / STEP) + 1)}
            onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); if (indexed.loading) return; startTransition(() => setLimit((current) => current + STEP)); }}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border px-5 text-sm font-bold hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Show {Math.min(STEP, total - visible.length)} more<ArrowRight className="size-4 rotate-90" aria-hidden />
          </a>
        </div>
      ) : null}
    </div>
  );
}
