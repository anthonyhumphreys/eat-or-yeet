"use client";

import { useLocation } from "@/components/location-provider";
import { regionNames, type WarningRegion } from "@/lib/location";

const buttonClass = "inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const secondaryButtonClass = "inline-flex min-h-12 items-center justify-center rounded-full border px-5 text-sm font-bold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export function NotionConnectControls({ serviceOrigin }: { serviceOrigin: string }) {
  const { region, needsRegionChoice } = useLocation();
  const connectUrl = (value: WarningRegion) => `${serviceOrigin}/connect?region=${value}`;
  return (
    <div className="mt-8 flex flex-col items-start gap-3">
      {needsRegionChoice ? (
        <>
          <p className="text-sm font-semibold">Choose the country whose warnings you want to check.</p>
          <div className="flex flex-wrap gap-3">
            <a className={buttonClass} href={connectUrl("UK")}>Add to Notion for UK</a>
            <a className={secondaryButtonClass} href={connectUrl("US")}>Add to Notion for US</a>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold">Warning country: {regionNames[region]}</p>
          <a className={buttonClass} href={connectUrl(region)}>Add to Notion</a>
        </>
      )}
      <a className="mt-1 inline-flex min-h-11 items-center rounded-sm text-sm font-semibold underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href={`${serviceOrigin}/`}>
        Manage, reconnect or disconnect a Notion list
      </a>
    </div>
  );
}
