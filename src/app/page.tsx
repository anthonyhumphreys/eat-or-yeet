import { Suspense } from "react";

import { WarningFeed, type WarningParams } from "@/components/incidents/warning-feed";
import { parseRegion, regionNames } from "@/lib/location";
import { getPreferredRegion } from "@/lib/location-server";

export default async function Home({ searchParams }: { searchParams: Promise<WarningParams> }) {
  const [params, preference] = await Promise.all([searchParams, getPreferredRegion()]);
  const region = parseRegion(params.region) ?? preference;
  return (
    <div className="page-shell py-6 sm:py-8">
      <section className="mb-6 max-w-4xl">
        <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">Food warnings. Before your next bite.</h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">Current food recalls and safety alerts in the {regionNames[region]}. Find affected products and official advice, or check your pack.</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{region === "UK" ? "Warnings from the Food Standards Agency." : "Warnings from the FDA and USDA FSIS."} A missing warning does not mean food is safe to eat.</p>
      </section>
      <Suspense key={JSON.stringify([region, params.q, params.category, params.store, params.page])} fallback={<p role="status" className="py-8">Loading current {region} warnings…</p>}>
        <WarningFeed params={params} region={region} path="/" />
      </Suspense>
    </div>
  );
}
