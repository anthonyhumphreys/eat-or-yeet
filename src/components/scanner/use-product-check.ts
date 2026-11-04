"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { trackWebsiteEvent } from "@/lib/analytics/browser";
import type { ProductObservation } from "@/lib/domain/schemas";
import type { VerdictResult } from "@/lib/domain/types";
import type { WarningRegion } from "@/lib/location";

type CheckState = { region: WarningRegion; pending: boolean; result: VerdictResult | null; error: string | null };

export function useProductCheck(region: WarningRegion, method: "barcode" | "details" | "scan") {
  const [state, setState] = useState<CheckState>({ region, pending: false, result: null, error: null });
  const active = useRef<AbortController | null>(null);
  if (state.region !== region) setState({ region, pending: false, result: null, error: null });

  // Changing country or leaving the page invalidates the request, while the form keeps its values.
  useEffect(() => () => { active.current?.abort(); active.current = null; }, [region]);

  const reset = useCallback(() => {
    active.current?.abort();
    active.current = null;
    setState({ region, pending: false, result: null, error: null });
  }, [region]);

  const check = useCallback(async (observation: ProductObservation) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    setState({ region, pending: true, result: null, error: null });
    trackWebsiteEvent({ event: "website_check_started", method, region });
    try {
      const response = await fetch("/api/check", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal,
        body: JSON.stringify({ observation, region }),
      });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The check service is unavailable. Try again shortly.");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The check failed. Try again shortly.");
      if (controller.signal.aborted || active.current !== controller) return;
      signal.throwIfAborted();
      setState({ region, pending: false, result: payload, error: null });
      trackWebsiteEvent({ event: "website_check_finished", method, region, outcome: payload.verdict });
    } catch (cause) {
      if (controller.signal.aborted || active.current !== controller) return;
      const error = signal.aborted ? "The check took too long. Your details are still here; try again."
        : cause instanceof Error ? cause.message : "The check failed. Try again shortly.";
      setState({ region, pending: false, result: null, error });
      trackWebsiteEvent({ event: "website_check_finished", method, region, outcome: "error" });
    } finally {
      if (active.current === controller) active.current = null;
    }
  }, [region, method]);

  // A result for a previous country must never be presented as a check for the current one.
  const current = state.region === region ? state : { pending: false, result: null, error: null };
  return { ...current, check, reset };
}
