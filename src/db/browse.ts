import "server-only";
import { unstable_cache } from "next/cache";
import { api } from "@backend/api";
import { fetchQuery } from "@backend/client";
import { BackendError } from "@backend/values";
import type { ExplorerFilters } from "@/lib/incidents/browse-navigation";
import type { WarningRegion } from "@/lib/location";

const cachedPage = unstable_cache(async (url: string, region: WarningRegion, filters: ExplorerFilters, cursor: string | null, version: string) => {
  return fetchQuery(api.browse.list, { region, filters, cursor: cursor ?? undefined, expectedVersion: version }, { url });
}, ["indexed-warning-browse-v1"], { revalidate: 60 });

export function browseRestart(error: unknown) {
  return error instanceof BackendError && typeof error.data === "object" && error.data !== null && "code" in error.data && error.data.code === "BROWSE_RESTART";
}

export async function getBrowsePage(region: WarningRegion, filters: ExplorerFilters, cursor: string | null = null) {
  const url = process.env.BACKEND_URL;
  if (!url) throw new Error("BACKEND_URL is required to load warnings.");
  const version = await fetchQuery(api.incidents.getDatasetVersion, { region }, { url });
  const page = await cachedPage(url,region,filters,cursor,version);
  if (Date.now() >= page.asOf+600000 || (page.boundaryAt !== null && Date.now() >= page.boundaryAt)) {
    return fetchQuery(api.browse.list,{region,filters,cursor:cursor ?? undefined,expectedVersion:version},{url});
  }
  return page;
}

export async function getInitialBrowse(region: WarningRegion, filters: ExplorerFilters, pages: number) {
  for (let attempt=0;attempt<2;attempt++) {
    try {
      let page = await getBrowsePage(region,filters);
      const rows = [...page.rows];
      // Direct links restore explicitly requested pages; the normal first visit reads one page.
      const count = Math.min(pages,Math.ceil(page.total/40),100);
      for (let index=1;index<count && page.nextCursor;index++) {
        page = await getBrowsePage(region,filters,page.nextCursor);
        rows.push(...page.rows);
      }
      return {...page,rows};
    } catch (error) { if (attempt || !browseRestart(error)) throw error; }
  }
  throw new Error("The recall list changed. Please retry.");
}
