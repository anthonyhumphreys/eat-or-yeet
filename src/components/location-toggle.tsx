"use client";

import { useLocation } from "@/components/location-provider";
import { regionNames, type WarningRegion } from "@/lib/location";

export function LocationToggle() {
  const { region, setRegion, isPending } = useLocation();
  return (
    <div role="group" aria-label="Warning location" aria-busy={isPending} className={`flex h-10 items-center rounded-full border bg-muted/60 p-0.5 transition-opacity ${isPending ? "opacity-70" : ""}`}>
      {(Object.keys(regionNames) as WarningRegion[]).map((value) => {
        const active = value === region;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            aria-label={regionNames[value]}
            title={regionNames[value]}
            onClick={() => setRegion(value)}
            className={`h-full min-w-11 rounded-full px-3 text-[13px] font-bold tracking-wide transition-[background-color,color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${active ? "bg-background text-foreground shadow-[0_1px_3px_oklch(0.17_0.018_110/18%)]" : "text-muted-foreground hover:text-foreground"}`}
          >
            {value}
          </button>
        );
      })}
      <span role="status" className="sr-only">{isPending ? `Loading ${regionNames[region]} warnings…` : ""}</span>
    </div>
  );
}
