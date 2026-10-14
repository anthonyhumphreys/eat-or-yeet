import type { MutationCtx, QueryCtx } from "../operations";

type Region = "UK" | "US";

export async function datasetVersion(ctx: QueryCtx, region?: Region): Promise<string> {
  const regions: Region[] = region ? [region] : ["UK", "US"];
  const versions = await Promise.all(regions.map(async (item) => {
    const row = await ctx.db.query("datasetVersions").withIndex("by_region", (q) => q.eq("region", item)).unique();
    return `${item}:${row ? `${row._id}:${row.revision}` : "initial"}`;
  }));
  return versions.join("|");
}

// Update in the same transaction as the warning write, including partial imports.
export async function bumpDatasetVersions(ctx: MutationCtx, regions: Iterable<Region>) {
  for (const region of new Set(regions)) {
    const row = await ctx.db.query("datasetVersions").withIndex("by_region", (q) => q.eq("region", region)).unique();
    if (row) await ctx.db.patch(row._id, { revision: row.revision + 1 });
    else await ctx.db.insert("datasetVersions", { region, revision: 1 });
  }
}
