import type { Metadata } from "next";
import { Suspense } from "react";

import { WarningFeed, type WarningParams } from "@/components/incidents/warning-feed";
import { parseRegion, regionNames } from "@/lib/location";
import { getPreferredRegion } from "@/lib/location-server";

export const metadata: Metadata = { title: "Browse food warnings", description: "Browse current official food-safety warnings by food category and named retailer." };

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<WarningParams> }) {
  const [params, preference] = await Promise.all([searchParams, getPreferredRegion()]);
  const region = parseRegion(params.region) ?? preference;
  return (
    <div className="page-shell py-8 sm:py-12">
      <div className="mb-8 max-w-2xl">
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Browse food warnings</h1>
        <p className="mt-4 leading-7 text-muted-foreground">Current official warnings for the {regionNames[region]}. Open a notice for the exact affected products, codes, and advice. Change your location in the top bar.</p>
      </div>
      <Suspense fallback={<p role="status" className="py-8">Loading current {region} warnings…</p>}>
        <WarningFeed params={params} region={region} path="/incidents" />
      </Suspense>
    </div>
  );
}
