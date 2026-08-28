"use client";

import { Camera, ScanBarcode } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { BarcodeCamera } from "@/components/scanner/barcode-camera";
import { ObservationForm } from "@/components/scanner/observation-form";
import { PhotoPicker } from "@/components/scanner/photo-picker";
import { Button } from "@/components/ui/button";
import { emptyObservation, type ProductObservation } from "@/lib/domain/schemas";
import type { VerdictResult } from "@/lib/domain/types";
import { VerdictView } from "@/components/verdict/verdict-view";

type Step = "barcode" | "photo" | "verify" | "checking" | "result";
const checkingMessages = ["Looking for recalled batches…", "Checking the food-safety receipts…", "Comparing official warning details…"];

export function ScanFlow({ initialMode }: { initialMode: "barcode" | "photo" }) {
  const [step, setStep] = useState<Step>(initialMode);
  const [region, setRegion] = useState<"UK" | "US">("UK");
  const [observation, setObservation] = useState<ProductObservation>(emptyObservation());
  const [result, setResult] = useState<VerdictResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkingMessage, setCheckingMessage] = useState(0);

  useEffect(() => {
    if (step !== "checking") return;
    const interval = window.setInterval(() => setCheckingMessage((current) => (current + 1) % checkingMessages.length), 900);
    return () => window.clearInterval(interval);
  }, [step]);

  const check = useCallback(async (nextObservation: ProductObservation) => {
    setObservation(nextObservation);
    setCheckingMessage(0);
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
      setStep("verify");
    }
  }, [region]);

  function reset() {
    setObservation(emptyObservation());
    setResult(null);
    setError(null);
    setStep("barcode");
  }

  if (step === "result" && result) return <VerdictView result={result} onReset={reset} onAddPhoto={() => setStep("photo")} onEdit={() => setStep("verify")} />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div><p className="text-sm font-semibold text-muted-foreground">Warning region</p><div className="mt-1 flex rounded-full bg-muted p-1" aria-label="Warning region">
          {(["UK", "US"] as const).map((item) => <button type="button" key={item} onClick={() => setRegion(item)} className={`rounded-full px-4 py-1.5 text-sm font-bold ${region === item ? "bg-background shadow-sm" : "text-muted-foreground"}`} aria-pressed={region === item}>{item}</button>)}
        </div></div>
        <div className="flex gap-1 rounded-full border p-1">
          <Button type="button" size="sm" variant={step === "barcode" ? "secondary" : "ghost"} className="rounded-full" onClick={() => setStep("barcode")}><ScanBarcode aria-hidden />Scan</Button>
          <Button type="button" size="sm" variant={step === "photo" ? "secondary" : "ghost"} className="rounded-full" onClick={() => setStep("photo")}><Camera aria-hidden />Photo</Button>
        </div>
      </div>

      {step === "barcode" ? <BarcodeCamera onDetected={(barcode) => void check({ ...emptyObservation(), barcode })} /> : null}
      {step === "photo" ? <PhotoPicker onObservation={(found) => void check(found)} /> : null}
      {step === "verify" ? <ObservationForm observation={observation} onSubmit={(found) => void check(found)} heading="Edit checked details" description="Fix anything the camera misread, then run the check again." /> : null}
      {step === "checking" ? <div className="grid min-h-96 place-items-center rounded-xl bg-card p-8 text-center"><div><p className="sr-only" role="status">Checking the product against current official {region} warnings.</p><div className="relative mx-auto grid size-20 place-items-center rounded-full bg-foreground text-background"><ScanBarcode className="size-10 text-primary" aria-hidden /><span className="absolute inset-0 rounded-full border border-primary/60 motion-safe:animate-ping" /></div><h2 className="mt-6 min-h-16 text-2xl font-black" aria-hidden>{checkingMessages[checkingMessage]}</h2><p className="mt-2 text-sm text-muted-foreground">Comparing the evidence with current official {region} warnings.</p></div></div> : null}
      {error ? <p role="alert" className="mt-4 rounded-lg bg-yeet-soft p-4 text-sm font-medium text-yeet">{error}</p> : null}
    </div>
  );
}
