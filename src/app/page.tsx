import { Suspense } from "react";

import { WarningFeed, type WarningParams } from "@/components/incidents/warning-feed";
import { WarningFeedSkeleton } from "@/components/incidents/warning-feed-skeleton";
import { parseRegion } from "@/lib/location";
import { getPreferredRegion } from "@/lib/location-server";

const sources = { UK: "the Food Standards Agency", US: "the FDA and USDA" } as const;

export default async function Home({ searchParams }: { searchParams: Promise<WarningParams> }) {
  const [params, preference] = await Promise.all([searchParams, getPreferredRegion()]);
  const region = parseRegion(params.region) ?? preference;
  return (
    <div className="page-shell py-5 sm:py-10">
      <section className="mb-4 sm:mb-7">
        <h1 className="text-[1.75rem] font-black leading-[1.05] tracking-[-0.035em] sm:text-5xl">{region} recalls</h1>
        {/* On phones the list should start near the top, so the longer introduction is for wider screens. */}
        <p className="mt-3 hidden max-w-2xl text-base leading-7 text-muted-foreground sm:block">
          Recall notices and allergy alerts from {sources[region]}, newest first. A missing warning does not mean a product is safe.
        </p>
      </section>
      <Suspense key={region} fallback={<WarningFeedSkeleton />}>
        <WarningFeed params={params} region={region} path="/" />
      </Suspense>
    </div>
  );
}
