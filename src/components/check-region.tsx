"use client";

import { useId } from "react";

import { useLocation } from "@/components/location-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { parseRegion, regionNames, type WarningRegion } from "@/lib/location";

export function CheckRegion() {
  const id = useId();
  const { region, suggestedRegion, needsRegionChoice, setRegion, isPending } = useLocation();

  return (
    <div className="my-5 rounded-xl border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Label htmlFor={id} className="font-bold">Where did you buy this food?</Label>
          <p id={`${id}-help`} className="mt-1 text-sm leading-6 text-muted-foreground">Warnings differ by country. Choose where you bought it.</p>
        </div>
        <select
          id={id}
          aria-describedby={`${id}-help`}
          aria-busy={isPending}
          value={region}
          onChange={(event) => { const next = parseRegion(event.target.value); if (next) setRegion(next); }}
          className="min-h-11 rounded-lg border bg-background px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {(Object.keys(regionNames) as WarningRegion[]).map((value) => <option key={value} value={value}>{regionNames[value]}</option>)}
        </select>
      </div>
      {!needsRegionChoice && suggestedRegion && suggestedRegion !== region ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 border-t pt-3 text-sm">
          <p className="text-muted-foreground">Suggested for you: {regionNames[suggestedRegion]}.</p>
          <Button type="button" variant="outline" size="sm" className="min-h-11 rounded-full" onClick={() => setRegion(suggestedRegion)}>Use {suggestedRegion} warnings</Button>
        </div>
      ) : null}
    </div>
  );
}
