"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useOptimistic, useState, useTransition, type ReactNode } from "react";

import { parseRegion, REGION_COOKIE, type WarningRegion } from "@/lib/location";

const LocationContext = createContext<{
  region: WarningRegion;
  setRegion: (region: WarningRegion) => void;
  isPending: boolean;
} | null>(null);

export function LocationProvider({ initialRegion, children }: { initialRegion: WarningRegion; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlRegion = parseRegion(searchParams.get("region"));
  const [selection, setSelection] = useState({ preference: urlRegion ?? initialRegion, urlRegion });
  if (selection.urlRegion !== urlRegion) {
    setSelection({ preference: urlRegion ?? selection.preference, urlRegion });
  }
  const [region, setOptimisticRegion] = useOptimistic(urlRegion ?? selection.preference);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (urlRegion) savePreference(urlRegion);
  }, [urlRegion]);

  function setRegion(nextRegion: WarningRegion) {
    if (nextRegion === region) return;
    savePreference(nextRegion);
    startTransition(() => {
      setOptimisticRegion(nextRegion);
      setSelection((current) => ({ ...current, preference: nextRegion }));
      if (pathname === "/" || pathname === "/incidents" || searchParams.has("region")) {
        const params = new URLSearchParams(searchParams.toString());
        params.set("region", nextRegion);
        params.delete("store");
        params.delete("page");
        router.replace(`${pathname}?${params}`, { scroll: false });
      }
    });
  }

  return <LocationContext.Provider value={{ region, setRegion, isPending }}>{children}</LocationContext.Provider>;
}

function savePreference(region: WarningRegion) {
  document.cookie = `${REGION_COOKIE}=${region}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

export function useLocation() {
  const context = useContext(LocationContext);
  if (!context) throw new Error("useLocation must be used within LocationProvider");
  return context;
}
