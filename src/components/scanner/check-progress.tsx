"use client";

import { ScanBarcode } from "lucide-react";
import { useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}
function visible() { return document.visibilityState === "visible"; }
function serverVisible() { return true; }

export function CheckProgress({ region, message = "Checking published warnings" }: { region?: string; message?: string }) {
  const isVisible = useSyncExternalStore(subscribe, visible, serverVisible);
  return (
    <div className="grid min-h-72 place-items-center rounded-xl bg-card p-8 text-center" role="status" aria-live="polite">
      <div>
        <div className="relative mx-auto grid size-16 place-items-center overflow-hidden rounded-xl bg-foreground text-primary">
          <ScanBarcode className="size-8" aria-hidden />
          <span className="check-sweep absolute inset-x-3 top-1/2 h-px bg-primary" style={{ animationPlayState: isVisible ? "running" : "paused" }} aria-hidden />
        </div>
        <h2 className="mt-5 text-2xl font-black">{message}</h2>
        {region ? <p className="mt-2 text-sm text-muted-foreground">Comparing your pack details with current {region} warnings.</p> : null}
      </div>
    </div>
  );
}
