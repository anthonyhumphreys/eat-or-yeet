import { getBrowsePage, browseRestart } from "@/db/browse";
import { browseReturnUrl, type ExplorerFilters } from "@/lib/incidents/browse-navigation";
import { parseRegion } from "@/lib/location";
import type { HazardKind } from "@/lib/incidents/hazard";
import type { ProductCategory, SuperCategory } from "@/lib/incidents/browse";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const region = parseRegion(url.searchParams.get("region"));
  if (!region || url.search.length > 6000 || (url.searchParams.get("cursor")?.length ?? 0) > 4096) return Response.json({error:"Invalid warning filters"},{status:400});
  const canonical = browseReturnUrl(`/?${url.searchParams}`);
  if (!canonical) return Response.json({error:"Invalid warning filters"},{status:400});
  const params = new URL(canonical,"https://browse.invalid").searchParams;
  const filters: ExplorerFilters = {q:params.get("q") ?? "",hazard:(params.get("hazard") || undefined) as HazardKind | undefined,type:(params.get("type") || undefined) as SuperCategory | undefined,category:(params.get("category") || undefined) as ProductCategory | undefined,store:params.get("store") || undefined};
  try {
    return Response.json(await getBrowsePage(region,filters,url.searchParams.get("cursor")),{headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    return Response.json({error: browseRestart(error) ? "The recall list changed. Refreshing the list." : "Warnings are temporarily unavailable."},{status:browseRestart(error)?409:503,headers:{"Cache-Control":"no-store"}});
  }
}
