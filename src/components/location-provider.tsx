"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useOptimistic, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";

import { parseRegion, suggestBrowserRegion, REGION_COOKIE, type WarningRegion } from "@/lib/location";

const LocationContext = createContext<{
  region: WarningRegion;
  suggestedRegion?: WarningRegion;
  needsRegionChoice: boolean;
  setRegion: (region: WarningRegion) => void;
  isPending: boolean;
} | null>(null);

function subscribeToBrowserRegion() { return () => {}; }
function serverBrowserRegion() { return undefined; }
function browserRegion() {
  try {
    return suggestBrowserRegion(navigator.languages, Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return undefined;
  }
}

export function LocationProvider({ initialRegion, hasSavedRegion = false, suggestedRegion, children }: { initialRegion: WarningRegion; hasSavedRegion?: boolean; suggestedRegion?: WarningRegion; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlRegion = parseRegion(searchParams.get("region"));
  const browserSuggestion = useSyncExternalStore(subscribeToBrowserRegion, browserRegion, serverBrowserRegion);
  const [selection, setSelection] = useState({ preference: urlRegion ?? initialRegion, urlRegion, confirmed: hasSavedRegion });
  if (selection.urlRegion !== urlRegion) {
    setSelection({ ...selection, preference: urlRegion ?? selection.preference, urlRegion });
  }
  const [region, setOptimisticRegion] = useOptimistic(urlRegion ?? selection.preference);
  const [isPending, startTransition] = useTransition();

  function setRegion(nextRegion: WarningRegion) {
    savePreference(nextRegion);
    if (nextRegion === region) {
      setSelection((current) => ({ ...current, confirmed: true }));
      return;
    }
    startTransition(() => {
      setOptimisticRegion(nextRegion);
      setSelection((current) => ({ ...current, preference: nextRegion, confirmed: true }));
      if (pathname === "/" || pathname === "/incidents" || searchParams.has("region")) {
        const params = new URLSearchParams(searchParams.toString());
        params.set("region", nextRegion);
        params.delete("store");
        params.delete("page");
        router.replace(`${pathname}?${params}`, { scroll: false });
      }
    });
  }

  return <LocationContext.Provider value={{ region, suggestedRegion: suggestedRegion ?? browserSuggestion, needsRegionChoice: !selection.confirmed, setRegion, isPending }}>{children}</LocationContext.Provider>;
}

function savePreference(region: WarningRegion) {
  document.cookie = `${REGION_COOKIE}=${region}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

export function useLocation() {
  const context = useContext(LocationContext);
  if (!context) throw new Error("useLocation must be used within LocationProvider");
  return context;
}
