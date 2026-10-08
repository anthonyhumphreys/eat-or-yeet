"use client";

import { useLocation } from "@/components/location-provider";
import { Button } from "@/components/ui/button";
import { regionNames, type WarningRegion } from "@/lib/location";

export function RegionPrompt() {
  const { suggestedRegion, needsRegionChoice, setRegion } = useLocation();
  if (!needsRegionChoice) return null;
  const choices: WarningRegion[] = suggestedRegion === "US" ? ["US", "UK"] : ["UK", "US"];

  return (
    <aside className="border-b bg-secondary" aria-labelledby="region-prompt-heading">
      <div className="page-shell flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="region-prompt-heading" className="font-bold">Choose your warning region</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {suggestedRegion ? `Suggested for you: ${regionNames[suggestedRegion]}. ` : ""}Choose where you buy your food. We&apos;ll remember your choice.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {choices.map((choice) => <Button key={choice} type="button" variant={choice === suggestedRegion ? "solid" : "outline"} className="min-h-11 rounded-full font-bold" onClick={() => setRegion(choice)}>Use {choice} warnings</Button>)}
        </div>
      </div>
    </aside>
  );
}
