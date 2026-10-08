import { Suspense } from "react";

import { WarningFeed, type WarningParams } from "@/components/incidents/warning-feed";
import { WarningFeedSkeleton } from "@/components/incidents/warning-feed-skeleton";
import { parseRegion, regionNames } from "@/lib/location";
import { getPreferredRegion } from "@/lib/location-server";

export default async function Home({ searchParams }: { searchParams: Promise<WarningParams> }) {
  const [params, preference] = await Promise.all([searchParams, getPreferredRegion()]);
  const region = parseRegion(params.region) ?? preference;
  return (
    <div className="page-shell py-6 sm:py-10">
      <section className="mb-6 sm:mb-8">
        <h1 className="text-[2rem] font-black leading-[1.05] tracking-[-0.035em] sm:text-5xl">
          Food warnings. <span className="text-primary">Before your next bite.</span>
        </h1>
        <p className="mt-3 max-w-2xl text-[0.9375rem] leading-6 text-muted-foreground sm:text-base sm:leading-7">
          Current recalls and safety alerts for the {regionNames[region]}, from the official sources. A missing warning does not mean food is safe to eat.
        </p>
      </section>
      <Suspense key={region} fallback={<WarningFeedSkeleton />}>
        <WarningFeed params={params} region={region} path="/" />
      </Suspense>
    </div>
  );
}
