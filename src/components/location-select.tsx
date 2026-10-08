"use client";

import { ChevronDown } from "lucide-react";

import { useLocation } from "@/components/location-provider";
import { parseRegion, regionNames, type WarningRegion } from "@/lib/location";

export function LocationSelect() {
  const { region, setRegion, isPending } = useLocation();
  return (
    <div className={`relative h-10 transition-opacity ${isPending ? "opacity-70" : ""}`}>
      <select
        aria-label="Warning location"
        aria-busy={isPending}
        title={regionNames[region]}
        value={region}
        onChange={(event) => { const next = parseRegion(event.target.value); if (next) setRegion(next); }}
        className="h-full w-[4.75rem] cursor-pointer appearance-none rounded-full border bg-muted/60 pl-3.5 pr-8 text-[13px] font-bold tracking-wide text-transparent hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {(Object.keys(regionNames) as WarningRegion[]).map((value) => (
          <option key={value} value={value} className="bg-background text-foreground">{regionNames[value]}</option>
        ))}
      </select>
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[13px] font-bold tracking-wide">{region}</span>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <span role="status" className="sr-only">{isPending ? `Loading ${regionNames[region]} warnings…` : ""}</span>
    </div>
  );
}
