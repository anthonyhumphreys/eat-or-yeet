"use client";

import { ChevronLeft } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { useLocation } from "@/components/location-provider";
import { regionNames } from "@/lib/location";

import { BarcodeCamera } from "@/components/scanner/barcode-camera";
import { BarcodeField, barcodeStatus } from "@/components/scanner/barcode-field";
import { CheckProgress } from "@/components/scanner/check-progress";
import { useProductCheck } from "@/components/scanner/use-product-check";
import { Button } from "@/components/ui/button";
import { emptyObservation } from "@/lib/domain/observation";
import type { ProductObservation } from "@/lib/domain/schemas";

const VerdictView = dynamic(() => import("@/components/verdict/verdict-view").then((module) => module.VerdictView), {
  loading: () => <CheckProgress message="Opening your warning check…" />,
});
const ObservationForm = dynamic(() => import("@/components/scanner/observation-form").then((module) => module.ObservationForm), {
  loading: () => <p role="status" className="min-h-72 py-6 text-sm text-muted-foreground">Opening label details…</p>,
});

type Step = "barcode" | "details";

export function ScanFlow() {
  const [entryStep, setStep] = useState<Step>("barcode");
  const { region, needsRegionChoice } = useLocation();
  const [observation, setObservation] = useState<ProductObservation>(emptyObservation);
  const { pending, result, error, check: runCheck, reset: resetCheck } = useProductCheck(region, "scan");
  const step = pending ? "checking" : error ? "error" : entryStep;
  const [typed, setTyped] = useState("");
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (step === "details" || step === "error") stepHeadingRef.current?.focus();
  }, [step]);

  const check = useCallback((nextObservation: ProductObservation) => {
    setObservation(nextObservation);
    return runCheck(nextObservation);
  }, [runCheck]);

  const onDetected = useCallback((barcode: string) => {
    void check({ ...emptyObservation(), barcode });
  }, [check]);

  function reset() {
    setObservation(emptyObservation());
    resetCheck();
    setTyped("");
    setStep("barcode");
  }

  if (result) {
    return <VerdictView result={result} onReset={reset} onEdit={() => { setObservation(result.observation); resetCheck(); setStep("details"); }} onRetry={() => void check(result.observation)} />;
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
              <button type="button" className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold underline underline-offset-4 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => { resetCheck(); setObservation(emptyObservation()); setStep("details"); }}>
                No barcode? Use label details
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {step === "details" ? (
        <section aria-labelledby="details-heading">
          <button type="button" className="-ml-2 mb-3 inline-flex min-h-10 items-center gap-1 rounded-full px-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => { resetCheck(); setStep("barcode"); }}><ChevronLeft className="size-4" aria-hidden />Back to scanner</button>
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
            <Button type="button" variant="outline" size="lg" className="min-h-12 rounded-full" onClick={() => { resetCheck(); setStep("details"); }}>Add label details</Button>
            <Button type="button" variant="ghost" size="lg" onClick={reset}>Scan another barcode</Button>
          </div>
        </section>
      ) : null}

      {step === "checking" ? <CheckProgress region={region} /> : null}
      {error ? <p role="alert" className="mt-4 rounded-lg bg-yeet-soft p-4 text-sm font-medium text-yeet">{error}</p> : null}
      <p className="mt-6 text-sm leading-6 text-muted-foreground">This checks published warnings, not whether food is safe to eat.</p>
    </div>
  );
}
