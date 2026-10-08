import type { Metadata } from "next";
import { Suspense } from "react";

import { WarningFeed, type WarningParams } from "@/components/incidents/warning-feed";
import { WarningFeedSkeleton } from "@/components/incidents/warning-feed-skeleton";
import { parseRegion, regionNames } from "@/lib/location";
import { getPreferredRegion } from "@/lib/location-server";

export const metadata: Metadata = { title: "Browse food warnings", description: "Browse current official food-safety warnings by hazard, food category and named retailer." };

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<WarningParams> }) {
  const [params, preference] = await Promise.all([searchParams, getPreferredRegion()]);
  const region = parseRegion(params.region) ?? preference;
  return (
    <div className="page-shell py-6 sm:py-10">
      <div className="mb-6 max-w-2xl sm:mb-8">
        <h1 className="text-[2rem] font-black leading-[1.05] tracking-[-0.035em] sm:text-5xl">Browse food warnings</h1>
        <p className="mt-3 leading-7 text-muted-foreground">Current official warnings for the {regionNames[region]}. Open a notice for the exact affected products, codes and advice.</p>
      </div>
      <Suspense key={region} fallback={<WarningFeedSkeleton />}>
        <WarningFeed params={params} region={region} path="/incidents" />
      </Suspense>
    </div>
  );
}
