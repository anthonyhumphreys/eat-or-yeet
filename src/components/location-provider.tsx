"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { parseRegion, REGION_COOKIE, type WarningRegion } from "@/lib/location";

const LocationContext = createContext<{
  region: WarningRegion;
  setRegion: (region: WarningRegion) => void;
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
  const region = urlRegion ?? selection.preference;

  useEffect(() => {
    if (urlRegion) savePreference(urlRegion);
  }, [urlRegion]);

  function setRegion(nextRegion: WarningRegion) {
    savePreference(nextRegion);
    setSelection((current) => ({ ...current, preference: nextRegion }));
    if (pathname === "/" || pathname === "/incidents" || searchParams.has("region")) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("region", nextRegion);
      params.delete("store");
      router.replace(`${pathname}?${params}`, { scroll: false });
    } else {
      router.refresh();
    }
  }

  return <LocationContext.Provider value={{ region, setRegion }}>{children}</LocationContext.Provider>;
}

function savePreference(region: WarningRegion) {
  document.cookie = `${REGION_COOKIE}=${region}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

export function useLocation() {
  const context = useContext(LocationContext);
  if (!context) throw new Error("useLocation must be used within LocationProvider");
  return context;
}
