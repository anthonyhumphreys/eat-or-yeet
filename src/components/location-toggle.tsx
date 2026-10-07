"use client";

import { ChevronDown, Globe } from "lucide-react";

import { useLocation } from "@/components/location-provider";
import { parseRegion, regionNames } from "@/lib/location";

export function LocationToggle() {
  const { region, setRegion } = useLocation();
  return (
    <div className="relative">
      <Globe className="pointer-events-none absolute left-3 top-1/2 hidden size-4 -translate-y-1/2 text-muted-foreground sm:block" aria-hidden />
      <select
        aria-label="Warning location"
        value={region}
        onChange={(event) => {
          const nextRegion = parseRegion(event.target.value);
          if (nextRegion) setRegion(nextRegion);
        }}
        className="min-h-11 w-40 appearance-none rounded-full border bg-background pl-3 pr-8 text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-48 sm:pl-9"
      >
        {Object.entries(regionNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </div>
  );
}
