"use client";

import { PackageSearch, ScanBarcode } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useLocation } from "@/components/location-provider";
import { regionNames } from "@/lib/location";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VerdictView } from "@/components/verdict/verdict-view";
import { emptyObservation, type ProductObservation } from "@/lib/domain/schemas";
import { isValidGtin } from "@/lib/domain/gtin";
import type { VerdictResult } from "@/lib/domain/types";

type SearchMode = "barcode" | "details";

export function ManualSearch({ initialMode = "barcode" }: { initialMode?: SearchMode }) {
  const { region } = useLocation();
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [observation, setObservation] = useState<ProductObservation>(emptyObservation());
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<VerdictResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update(key: keyof ProductObservation, value: string) {
    setObservation((current) => ({ ...current, [key]: value || null }));
  }

  const barcode = observation.barcode ?? "";
  const barcodeInvalid = Boolean(barcode) && !isValidGtin(barcode);
  const hasEvidence = mode === "barcode"
    ? isValidGtin(barcode)
    : Boolean(observation.productName || observation.brand || observation.barcode || observation.batchCode || observation.lotCode || observation.producer || observation.establishmentNumber || observation.eggMark?.producerCode);

  async function check() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observation, region }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The check failed.");
      setResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The check failed.");
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return <VerdictView
      result={result}
      onReset={() => { setResult(null); setObservation(emptyObservation()); }}
      onEdit={() => setResult(null)}
    />;
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void check(); }}>
      <div className="max-w-xl">
        <h1 className="text-4xl font-black tracking-[-0.035em] sm:text-5xl">Enter food details</h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">Start with a barcode. If you do not have one, add the clearest details from the label.</p>
        <Link href="/scan" className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm font-bold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><ScanBarcode className="size-4" aria-hidden />Use the camera scanner</Link>
      </div>

      <div className="mt-7 flex flex-wrap items-end justify-between gap-5 border-y py-5">
        <p className="text-sm leading-6 text-muted-foreground">Checking warnings from the <span className="font-semibold text-foreground">{regionNames[region]}</span>. Change location in the top bar.</p>
        <fieldset>
          <legend className="text-sm font-semibold text-muted-foreground">Search by</legend>
          <div className="mt-2 flex rounded-full border p-1">
            <button type="button" aria-pressed={mode === "barcode"} onClick={() => setMode("barcode")} className={`flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-bold transition-colors ${mode === "barcode" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground"}`}><ScanBarcode className="size-4" aria-hidden />Barcode</button>
            <button type="button" aria-pressed={mode === "details"} onClick={() => setMode("details")} className={`flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-bold transition-colors ${mode === "details" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground"}`}><PackageSearch className="size-4" aria-hidden />Label details</button>
          </div>
        </fieldset>
      </div>

      {mode === "barcode" ? (
        <div className="py-7">
          <Label htmlFor="manual-barcode" className="text-base font-bold">Barcode number</Label>
          <Input
            id="manual-barcode"
            name="barcode"
            inputMode="numeric"
            autoComplete="off"
            value={barcode}
            onChange={(event) => update("barcode", event.target.value)}
            placeholder="860014523113"
            aria-invalid={barcodeInvalid}
            aria-describedby="barcode-hint"
            className="mt-3 h-14 px-4 text-lg font-semibold tabular-nums md:text-lg"
          />
          <p id="barcode-hint" className={`mt-3 text-sm leading-6 ${barcodeInvalid ? "font-semibold text-yeet" : "text-muted-foreground"}`}>
            {barcodeInvalid ? "Enter a valid 8, 12, 13, or 14 digit barcode with its check digit." : "Enter the digits printed beneath the barcode."}
          </p>
        </div>
      ) : (
        <div className="py-7">
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="manual-product">Product name</Label><Input id="manual-product" value={observation.productName ?? ""} onChange={(event) => update("productName", event.target.value)} placeholder="Alfalfa sprouts" className="h-11 px-3" /></div>
            <div className="space-y-2"><Label htmlFor="manual-brand">Brand</Label><Input id="manual-brand" value={observation.brand ?? ""} onChange={(event) => update("brand", event.target.value)} placeholder="Brand on the pack" className="h-11 px-3" /></div>
            <div className="space-y-2"><Label htmlFor="manual-details-barcode">Barcode number</Label><Input id="manual-details-barcode" inputMode="numeric" autoComplete="off" value={barcode} onChange={(event) => update("barcode", event.target.value)} placeholder="860014523113" aria-invalid={barcodeInvalid} aria-describedby="details-barcode-hint" className="h-11 px-3 tabular-nums" /><p id="details-barcode-hint" className={`text-xs leading-5 ${barcodeInvalid ? "font-semibold text-yeet" : "text-muted-foreground"}`}>{barcodeInvalid ? "Enter a valid 8, 12, 13, or 14 digit barcode with its check digit." : "Optional. Include the check digit."}</p></div>
            <div className="space-y-2"><Label htmlFor="manual-batch">Batch code</Label><Input id="manual-batch" value={observation.batchCode ?? ""} onChange={(event) => update("batchCode", event.target.value)} placeholder="24182" className="h-11 px-3" /></div>
            <div className="space-y-2"><Label htmlFor="manual-lot">Lot code</Label><Input id="manual-lot" value={observation.lotCode ?? ""} onChange={(event) => update("lotCode", event.target.value)} placeholder="LOT A17" className="h-11 px-3" /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="manual-date">Use-by or best-before</Label><Input id="manual-date" type="date" value={observation.dates?.useBy ?? observation.dates?.bestBefore ?? ""} onChange={(event) => setObservation((current) => ({ ...current, dates: { useBy: event.target.value || null, bestBefore: null, productionDate: current.dates?.productionDate ?? null } }))} className="h-11 px-3" /></div>
          </div>

          <details className="mt-6 border-t pt-5">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-bold focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">More identifiers</summary>
            <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="manual-producer">Producer</Label><Input id="manual-producer" value={observation.producer ?? ""} onChange={(event) => update("producer", event.target.value)} placeholder="Producer or manufacturer" className="h-11 px-3" /></div>
              <div className="space-y-2"><Label htmlFor="manual-establishment">Establishment mark</Label><Input id="manual-establishment" value={observation.establishmentNumber ?? ""} onChange={(event) => update("establishmentNumber", event.target.value)} placeholder="UK AB123 EC" className="h-11 px-3" /></div>
              <div className="space-y-2"><Label htmlFor="manual-country">Country of origin</Label><Input id="manual-country" value={observation.countryOfOrigin ?? ""} onChange={(event) => update("countryOfOrigin", event.target.value)} placeholder="United States" className="h-11 px-3" /></div>
              <div className="space-y-2"><Label htmlFor="manual-egg">Egg producer code</Label><Input id="manual-egg" value={observation.eggMark?.producerCode ?? ""} onChange={(event) => setObservation((current) => ({ ...current, eggMark: { farmingMethod: current.eggMark?.farmingMethod ?? null, country: current.eggMark?.country ?? null, producerCode: event.target.value || null } }))} placeholder="1UK12345" className="h-11 px-3" /></div>
            </div>
          </details>
        </div>
      )}

      <Button disabled={pending || !hasEvidence || barcodeInvalid} size="lg" className="tactile h-13 w-full rounded-full text-base font-bold">{pending ? "Checking published warnings…" : "Check published warnings"}</Button>
      {error ? <p role="alert" className="mt-4 rounded-lg bg-yeet-soft p-4 text-sm font-medium text-yeet">{error}</p> : null}
      <p className="mt-5 text-sm leading-6 text-muted-foreground">This checks published warnings, not whether food is safe to eat.</p>
    </form>
  );
}
