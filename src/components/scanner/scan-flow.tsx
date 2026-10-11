"use client";

import { ChevronLeft, ScanBarcode } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useLocation } from "@/components/location-provider";
import { regionNames } from "@/lib/location";

import { BarcodeCamera } from "@/components/scanner/barcode-camera";
import { BarcodeField, barcodeStatus } from "@/components/scanner/barcode-field";
import { ObservationForm } from "@/components/scanner/observation-form";
import { VerdictView } from "@/components/verdict/verdict-view";
import { Button } from "@/components/ui/button";
import { emptyObservation, type ProductObservation } from "@/lib/domain/schemas";
import type { VerdictResult } from "@/lib/domain/types";
import { trackWebsiteEvent } from "@/lib/analytics/browser";

type Step = "barcode" | "details" | "checking" | "result" | "error";

export function ScanFlow() {
  const [step, setStep] = useState<Step>("barcode");
  const { region, needsRegionChoice } = useLocation();
  const [observation, setObservation] = useState<ProductObservation>(emptyObservation());
  const [result, setResult] = useState<VerdictResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (step === "details" || step === "error") stepHeadingRef.current?.focus();
  }, [step]);

  const check = useCallback(async (nextObservation: ProductObservation) => {
    trackWebsiteEvent({ event: "website_check_started", method: "scan", region });
    setObservation(nextObservation);
    setStep("checking");
    setError(null);
    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observation: nextObservation, region }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The check failed");
      setResult(payload);
      trackWebsiteEvent({ event: "website_check_finished", method: "scan", region, outcome: payload.verdict });
      setStep("result");
    } catch (cause) {
      trackWebsiteEvent({ event: "website_check_finished", method: "scan", region, outcome: "error" });
      setError(cause instanceof Error ? cause.message : "The check failed.");
      setStep("error");
    }
  }, [region]);

  const onDetected = useCallback((barcode: string) => {
    void check({ ...emptyObservation(), barcode });
  }, [check]);

  function reset() {
    setObservation(emptyObservation());
    setResult(null);
    setError(null);
    setTyped("");
    setStep("barcode");
  }

  if (step === "result" && result) {
    return <VerdictView result={result} onReset={reset} onEdit={() => { setObservation(result.observation); setStep("details"); }} onRetry={() => void check(result.observation)} />;
  }

  const typedValid = barcodeStatus(typed).state === "valid";

  return (
    <div>
      {step === "barcode" ? (
        <section aria-labelledby="scan-heading">
          <h1 id="scan-heading" className="text-[2rem] font-black leading-[1.05] tracking-[-0.035em] sm:text-5xl">Scan a barcode</h1>
          <p className="mb-5 mt-3 max-w-xl text-base leading-7 text-muted-foreground">Checking against current <span className="font-semibold text-foreground">{regionNames[region]}</span> warnings.</p>
          {needsRegionChoice ? <p role="status" className="rounded-xl bg-muted p-4 text-sm leading-6">Choose your country to start scanning.</p> : <BarcodeCamera onDetected={onDetected} />}
          <form className="mt-8 border-t pt-6" onSubmit={(event) => { event.preventDefault(); if (typedValid && !needsRegionChoice) onDetected(barcodeStatus(typed).digits); }}>
            <BarcodeField id="typed-barcode" label="Or type the number" value={typed} onChange={setTyped} />
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              <Button type="submit" variant="solid" size="lg" disabled={!typedValid || needsRegionChoice} className="min-h-12 rounded-full px-6 font-bold">Check published warnings</Button>
              <button type="button" className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold underline underline-offset-4 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => { setError(null); setObservation(emptyObservation()); setStep("details"); }}>
                No barcode? Use label details
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {step === "details" ? (
        <section aria-labelledby="details-heading">
          <button type="button" className="-ml-2 mb-3 inline-flex min-h-10 items-center gap-1 rounded-full px-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => { setError(null); setStep("barcode"); }}><ChevronLeft className="size-4" aria-hidden />Back to scanner</button>
          <div className="mb-5">
            <h1 id="details-heading" ref={stepHeadingRef} tabIndex={-1} className="text-[2rem] font-black leading-[1.05] tracking-[-0.035em] focus-visible:outline-none sm:text-5xl">Add label details</h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-muted-foreground">{observation.barcode ? "A batch code or date helps tell your pack apart from affected ones. Skip anything you can’t read." : "A product name, brand or batch code can find a published warning."}</p>
          </div>
          <ObservationForm
            observation={observation}
            onSubmit={(found) => void check(found)}
            submitLabel="Check published warnings"
          />
        </section>
      ) : null}
      {step === "error" ? (
        <section aria-labelledby="error-heading">
          <h1 id="error-heading" ref={stepHeadingRef} tabIndex={-1} className="text-[2rem] font-black leading-[1.05] tracking-[-0.035em] focus-visible:outline-none sm:text-5xl">Couldn&apos;t complete this check</h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">Try again, or add details from the label.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="button" variant="solid" size="lg" className="min-h-12 rounded-full font-bold" onClick={() => void check(observation)}>Try again</Button>
            <Button type="button" variant="outline" size="lg" className="min-h-12 rounded-full" onClick={() => { setError(null); setStep("details"); }}>Add label details</Button>
            <Button type="button" variant="ghost" size="lg" onClick={reset}>Scan another barcode</Button>
          </div>
        </section>
      ) : null}

      {step === "checking" ? (
        <div className="grid min-h-72 place-items-center rounded-xl bg-card p-8 text-center" role="status" aria-live="polite">
          <div>
            <div className="mx-auto grid size-16 place-items-center rounded-full bg-foreground text-background"><ScanBarcode className="size-8 text-primary" aria-hidden /></div>
            <h2 className="mt-5 text-2xl font-black">Checking published warnings</h2>
            <p className="mt-2 text-sm text-muted-foreground">Comparing the details with current {region} warnings.</p>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-4 rounded-lg bg-yeet-soft p-4 text-sm font-medium text-yeet">{error}</p> : null}
      <p className="mt-6 text-sm leading-6 text-muted-foreground">This checks published warnings, not whether food is safe to eat.</p>
    </div>
  );
}
