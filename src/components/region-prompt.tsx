"use client";

import { useState } from "react";

import { useLocation } from "@/components/location-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { regionNames, type WarningRegion } from "@/lib/location";

const sources: Record<WarningRegion, string> = {
  UK: "Food Standards Agency recalls",
  US: "FDA and USDA recalls",
};

/**
 * Asked once, on the first visit, as a pop-up rather than a banner on every page.
 * The suggested country is pre-selected so most people just confirm. Closing it keeps the selection.
 */
export function RegionPrompt() {
  const { region, suggestedRegion, needsRegionChoice, setRegion } = useLocation();
  const [picked, setPicked] = useState<WarningRegion | null>(null);
  const selected = picked ?? suggestedRegion ?? region;

  return (
    <Dialog open={needsRegionChoice} onOpenChange={(open) => { if (!open) setRegion(selected); }}>
      <DialogContent
        showCloseButton={false}
        className="top-auto bottom-0 max-w-full translate-y-0 gap-5 rounded-b-none p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:top-1/2 sm:bottom-auto sm:max-w-md sm:-translate-y-1/2 sm:rounded-b-xl sm:p-6"
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-black tracking-tight">Where do you buy your food?</DialogTitle>
          <DialogDescription className="text-[0.9375rem] leading-6">We&apos;ll show the official recalls for that country.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); setRegion(selected); }}>
          <fieldset className="grid gap-2">
            <legend className="sr-only">Country</legend>
            {(Object.keys(regionNames) as WarningRegion[]).map((choice) => (
              <label key={choice} className="flex cursor-pointer items-start gap-3 rounded-xl border bg-background p-4 transition-colors hover:border-muted-foreground has-checked:border-foreground has-checked:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
                <input
                  type="radio"
                  name="region-choice"
                  value={choice}
                  checked={selected === choice}
                  onChange={() => setPicked(choice)}
                  className="mt-1 size-4 shrink-0 accent-foreground focus-visible:outline-none"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 font-bold">
                    {regionNames[choice]}
                    {choice === suggestedRegion ? <span className="rounded-full bg-primary px-2 py-px text-[11px] font-bold text-primary-foreground">Suggested</span> : null}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{sources[choice]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Button type="submit" className="mt-5 h-12 w-full rounded-full text-base font-bold">Show {selected} recalls</Button>
          <p className="mt-3 text-center text-xs text-muted-foreground">You can switch any time from the top of the page.</p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
