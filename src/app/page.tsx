import { Info } from "lucide-react";
import { Suspense } from "react";

import { WarningFeed, type WarningParams } from "@/components/incidents/warning-feed";
import { parseRegion, regionNames } from "@/lib/location";
import { getPreferredRegion } from "@/lib/location-server";

export default async function Home({ searchParams }: { searchParams: Promise<WarningParams> }) {
  const [params, preference] = await Promise.all([searchParams, getPreferredRegion()]);
  const region = parseRegion(params.region) ?? preference;
  return (
    <div className="page-shell py-7 sm:py-10 lg:py-12">
      <section className="mb-7 grid gap-5 sm:mb-9 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end lg:gap-10">
        <h1 className="text-[clamp(2rem,4.2vw,3.75rem)] font-black leading-[1.08] tracking-[-0.035em]">
          <span className="block">Food warnings.</span>{" "}
          <span className="block text-primary">Before your next bite.</span>
        </h1>
        <div className="lg:pb-1">
          <p className="max-w-xl text-base leading-7 text-muted-foreground">Official food recalls and safety alerts for the <span className="font-semibold text-foreground">{regionNames[region]}</span>.</p>
          <p className="mt-3 flex max-w-xl items-start gap-2 text-sm leading-6 text-muted-foreground"><Info className="mt-1 size-4 shrink-0" aria-hidden /><span>A missing warning does not mean food is safe to eat.</span></p>
        </div>
      </section>
      <Suspense key={JSON.stringify([region, params.q, params.category, params.store, params.page])} fallback={<p role="status" className="py-8">Loading current {region} warnings…</p>}>
        <WarningFeed params={params} region={region} path="/" />
      </Suspense>
    </div>
  );
}
