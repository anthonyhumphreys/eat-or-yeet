import { ArrowRight, ScanBarcode } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { WarningExplorer, type ExplorerRow } from "@/components/incidents/warning-explorer";
import { RegionalNews } from "@/components/news/regional-news";
import { listActivePublicIncidents } from "@/db/queries";
import { foodCategories, type FoodCategory } from "@/lib/incidents/browse";
import { classifyHazard, hazardKinds, type HazardKind } from "@/lib/incidents/hazard";
import { type WarningRegion } from "@/lib/location";

import styles from "./warning-feed.module.css";

export type WarningParams = Record<string, string | string[] | undefined>;

function param(params: WarningParams, key: string) {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

export async function WarningFeed({ params, region, path }: { params: WarningParams; region: WarningRegion; path: "/" | "/incidents" }) {
  const [warnings] = await Promise.allSettled([listActivePublicIncidents(region)]);
  const rows: ExplorerRow[] | null = warnings.status === "fulfilled"
    ? warnings.value.filter((row) => row.region === region).map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      updatedAt: row.updatedAt.valueOf(),
      categories: row.categories as FoodCategory[],
      stores: row.stores,
      hazard: classifyHazard(row),
    }))
    : null;
  const category = param(params, "category");
  const hazard = param(params, "hazard");
  const page = param(params, "page");

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12">
      <WarningExplorer
        rows={rows}
        region={region}
        path={path}
        initialPage={page && /^\d{1,3}$/.test(page) ? Math.max(1, Number(page)) : 1}
        initial={{
          q: (param(params, "q") ?? "").slice(0, 120),
          hazard: hazardKinds.includes(hazard as HazardKind) ? hazard as HazardKind : undefined,
          category: foodCategories.includes(category as FoodCategory) ? category as FoodCategory : undefined,
          store: param(params, "store")?.slice(0, 120) || undefined,
        }}
      />
      <aside className="space-y-10 lg:sticky lg:top-6 lg:self-start">
        <section className={`${styles.scanPanel} hidden rounded-xl bg-secondary p-6 lg:block`}>
          <div className={styles.scanPreview} aria-hidden>
            <ScanBarcode className="size-14 text-secondary-foreground" strokeWidth={1.25} />
            <span className={styles.scanLine} />
          </div>
          <h2 className="mt-4 text-xl font-black leading-tight tracking-tight">Got the pack in your hand?</h2>
          <p className="mt-2 text-sm leading-6 text-secondary-foreground">Scan the barcode, add a batch code or date if you can read one, and compare it with published warnings.</p>
          <Link href="/scan" className="mt-5 flex min-h-12 items-center justify-between gap-3 rounded-full bg-foreground px-5 text-sm font-bold text-background transition-colors hover:bg-foreground/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Scan a barcode<ArrowRight className="size-4" aria-hidden /></Link>
          <Link href="/search" className="mt-1 inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-secondary-foreground underline underline-offset-4 hover:decoration-2 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Type the number instead</Link>
        </section>
        <Suspense key={region} fallback={null}>
          <RegionalNews region={region} />
        </Suspense>
      </aside>
    </div>
  );
}
