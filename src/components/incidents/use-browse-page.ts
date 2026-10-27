"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { filterUrl, type ExplorerFilters } from "@/lib/incidents/browse-navigation";
import type { BrowsePage } from "@/lib/incidents/browse-view";
import type { WarningRegion } from "@/lib/location";

const key = (filters: ExplorerFilters) => JSON.stringify([filters.q,filters.hazard,filters.type,filters.category,filters.store]);

export function useBrowsePage(initial: BrowsePage | undefined, region: WarningRegion, filters: ExplorerFilters, desired: number, setLimit: Dispatch<SetStateAction<number>>) {
  const [page,setPage] = useState(initial);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [retry,setRetry] = useState(0);
  const filterKey = key(filters);
  useEffect(() => {
    if (!initial || !page) return;
    const changed = key(page.filters) !== filterKey;
    if (!changed && (page.rows.length >= desired || !page.nextCursor)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);setError("");setNotice("");
      const read = async (cursor: string | null) => {
        const url = new URL(filterUrl("/api/warnings",region,filters),window.location.origin);
        if (cursor) url.searchParams.set("cursor",cursor);
        return fetch(url,{signal:controller.signal,cache:"no-store"});
      };
      try {
        let response = await read(changed ? null : page.nextCursor);
        let restart = false;
        if (response.status === 409) {response = await read(null);restart = true;}
        if (!response.ok) throw new Error("Warnings could not be updated. Try again.");
        const next: BrowsePage = await response.json();
        if (controller.signal.aborted) return;
        setPage({...next,rows:changed || restart ? next.rows : [...page.rows,...next.rows]});
        if (restart) { setLimit(40); setNotice("The recall list changed. Showing the latest first page."); }
        else setLimit(current => Math.max(40,Math.min(current,Math.ceil(next.total/40)*40)));
      } catch {
        if (!controller.signal.aborted) setError("Warnings could not be updated. Try again.");
      } finally {if (!controller.signal.aborted) setLoading(false);}
    },changed ? 300 : 0);
    return () => {window.clearTimeout(timer);controller.abort();};
  },[initial,page,region,filterKey,filters,desired,retry,setLimit]);
  return {page,loading,error,notice,retry:() => setRetry(value=>value+1)};
}
