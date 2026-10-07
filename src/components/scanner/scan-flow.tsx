"use client";

import { ScanBarcode } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useLocation } from "@/components/location-provider";
import { regionNames } from "@/lib/location";

import { BarcodeCamera } from "@/components/scanner/barcode-camera";
import { ObservationForm } from "@/components/scanner/observation-form";
import { VerdictView } from "@/components/verdict/verdict-view";
import { Button } from "@/components/ui/button";
import { emptyObservation, type ProductObservation } from "@/lib/domain/schemas";
import type { VerdictResult } from "@/lib/domain/types";

type Step = "barcode" | "details" | "checking" | "result";

export function ScanFlow() {
  const [step, setStep] = useState<Step>("barcode");
  const { region } = useLocation();
  const [observation, setObservation] = useState<ProductObservation>(emptyObservation());
  const [result, setResult] = useState<VerdictResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (step === "details") detailsHeadingRef.current?.focus();
  }, [step]);

  const check = useCallback(async (nextObservation: ProductObservation) => {
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
      setStep("result");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The check failed.");
      setStep("details");
    }
  }, [region]);

  const onDetected = useCallback((barcode: string) => {
    setObservation({ ...emptyObservation(), barcode });
    setError(null);
    setStep("details");
  }, []);

  function reset() {
    setObservation(emptyObservation());
    setResult(null);
    setError(null);
    setStep("barcode");
  }

  if (step === "result" && result) {
    return <VerdictView result={result} onReset={reset} onEdit={() => setStep("details")} />;
  }

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-5 border-b pb-5">
        <p className="text-sm leading-6 text-muted-foreground">Checking warnings from the <span className="font-semibold text-foreground">{regionNames[region]}</span>. Change location in the top bar.</p>
        <p className="max-w-sm text-sm leading-6 text-muted-foreground">We compare label details with published food-safety warnings in the selected region.</p>
      </div>

      {step === "barcode" ? (
        <section aria-labelledby="scan-heading">
          <div className="mb-5 max-w-xl">
            <h1 id="scan-heading" className="text-4xl font-black tracking-[-0.035em] sm:text-5xl">Scan a barcode</h1>
            <p className="mt-3 text-base leading-7 text-muted-foreground">Hold the barcode steady inside the frame. You can type it in or add label details if scanning does not work.</p>
          </div>
          <BarcodeCamera onDetected={onDetected} />
          <div className="mt-6">
            <Button type="button" variant="secondary" size="lg" className="min-h-12 rounded-full" onClick={() => { setError(null); setStep("details"); }}>
              Enter details manually
            </Button>
          </div>
        </section>
      ) : null}

      {step === "details" ? (
        <section aria-labelledby="details-heading">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 id="details-heading" ref={detailsHeadingRef} tabIndex={-1} className="text-4xl font-black tracking-[-0.035em] focus-visible:outline-none sm:text-5xl">{observation.barcode ? "Review the barcode" : "Add label details"}</h1>
              <p className="mt-3 max-w-xl text-base leading-7 text-muted-foreground">{observation.barcode ? "Add a batch code or date if you can read one, then check published warnings." : "A barcode, product name, brand, or batch code can help find a published warning."}</p>
            </div>
            <Button type="button" variant="ghost" onClick={() => { setError(null); setStep("barcode"); }}>Back to scanner</Button>
          </div>
          <ObservationForm
            observation={observation}
            onSubmit={(found) => void check(found)}
            heading="Details from the pack"
            description="Add the clearest information you can read. Leave anything unknown blank."
            submitLabel="Check published warnings"
          />
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
