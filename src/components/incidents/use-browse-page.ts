"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { filterUrl, type ExplorerFilters } from "@/lib/incidents/browse-navigation";
import type { BrowsePage } from "@/lib/incidents/browse-view";
import type { WarningRegion } from "@/lib/location";

const key = (filters: ExplorerFilters) => JSON.stringify([filters.q, filters.hazard, filters.type, filters.category, filters.store]);

export function useBrowsePage(initial: BrowsePage | undefined, region: WarningRegion, filters: ExplorerFilters, desired: number, setLimit: Dispatch<SetStateAction<number>>) {
  const [page, setPage] = useState(initial);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [notice, setNotice] = useState("");
  const filterKey = key(filters);
  const operationKey = JSON.stringify([region, filterKey, desired]);
  const changed = Boolean(page && key(page.filters) !== filterKey);
  const needed = Boolean(initial && page && (changed || (page.rows.length < desired && page.nextCursor)));
  const error = failure?.key === operationKey ? failure.message : "";
  const loading = needed && !error;

  useEffect(() => {
    if (!loading || !page) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    const timer = window.setTimeout(async () => {
      setNotice("");
      const read = async (cursor: string | null) => {
        const url = new URL(filterUrl("/api/warnings", region, filters), window.location.origin);
        if (cursor) url.searchParams.set("cursor", cursor);
        return fetch(url, { signal, cache: "no-store" });
      };
      try {
        let response = await read(changed ? null : page.nextCursor);
        let restart = false;
        if (response.status === 409) { response = await read(null); restart = true; }
        if (!response.ok) throw new Error("Warnings could not be updated. Try again.");
        const next: BrowsePage = await response.json();
        if (controller.signal.aborted) return;
        setPage({ ...next, rows: changed || restart ? next.rows : [...page.rows, ...next.rows] });
        setFailure(null);
        if (restart) {
          setLimit(40);
          setNotice("The recall list changed. Showing the latest first page.");
        } else setLimit(current => Math.max(40, Math.min(current, Math.ceil(next.total / 40) * 40)));
      } catch {
        if (!controller.signal.aborted) setFailure({ key: operationKey, message: "Warnings could not be updated. Try again." });
      }
    }, changed ? 150 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loading, page, region, operationKey, changed, filters, setLimit]);

  return { page, loading, error, notice, retry: () => setFailure(null) };
}
