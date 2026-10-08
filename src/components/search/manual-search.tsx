"use client";

import { ChevronDown, PackageSearch, ScanBarcode } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useLocation } from "@/components/location-provider";
import { regionNames } from "@/lib/location";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarcodeField } from "@/components/scanner/barcode-field";
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

  const tab = (value: SearchMode, Icon: typeof ScanBarcode, label: string) => (
    <button type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm font-bold transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-none ${mode === value ? "bg-background text-foreground shadow-[0_1px_3px_oklch(0.17_0.018_110/18%)]" : "text-muted-foreground hover:text-foreground"}`}><Icon className="size-4" aria-hidden />{label}</button>
  );

  return (
    <form onSubmit={(event) => { event.preventDefault(); void check(); }}>
      <h1 className="text-[2rem] font-black leading-[1.05] tracking-[-0.035em] sm:text-5xl">Type it in</h1>
      <p className="mt-3 max-w-xl text-base leading-7 text-muted-foreground">Checking against current <span className="font-semibold text-foreground">{regionNames[region]}</span> warnings. <Link href="/scan" className="font-semibold text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Scan with your camera</Link> instead.</p>

      <fieldset className="mt-6">
        <legend className="sr-only">Check by</legend>
        <div className="flex rounded-full border bg-muted/60 p-0.5 sm:inline-flex">
          {tab("barcode", ScanBarcode, "Barcode")}
          {tab("details", PackageSearch, "Label details")}
        </div>
      </fieldset>

      {mode === "barcode" ? (
        <div className="py-7">
          <BarcodeField id="manual-barcode" value={barcode} onChange={(value) => update("barcode", value)} />
        </div>
      ) : (
        <div className="py-7">
          <p className="mb-5 text-sm leading-6 text-muted-foreground">Fill in whatever you can read. One clear detail is enough to start.</p>
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="manual-product">Product name</Label><Input id="manual-product" value={observation.productName ?? ""} onChange={(event) => update("productName", event.target.value)} placeholder="e.g. Mozzarella pearls" className="h-11 px-3" /></div>
            <div className="space-y-2"><Label htmlFor="manual-brand">Brand</Label><Input id="manual-brand" value={observation.brand ?? ""} onChange={(event) => update("brand", event.target.value)} className="h-11 px-3" /></div>
            <BarcodeField id="manual-details-barcode" value={barcode} onChange={(value) => update("barcode", value)} optional size="md" />
            <div className="space-y-2"><Label htmlFor="manual-batch">Batch code</Label><Input id="manual-batch" value={observation.batchCode ?? ""} onChange={(event) => update("batchCode", event.target.value)} placeholder="e.g. 24182" className="h-11 px-3" /></div>
            <div className="space-y-2"><Label htmlFor="manual-lot">Lot code</Label><Input id="manual-lot" value={observation.lotCode ?? ""} onChange={(event) => update("lotCode", event.target.value)} placeholder="e.g. LOT A17" className="h-11 px-3" /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="manual-date">Use-by or best-before</Label><Input id="manual-date" type="date" value={observation.dates?.useBy ?? observation.dates?.bestBefore ?? ""} onChange={(event) => setObservation((current) => ({ ...current, dates: { useBy: event.target.value || null, bestBefore: null, productionDate: current.dates?.productionDate ?? null } }))} className="h-11 px-3" /></div>
          </div>

          <details className="group mt-6 border-t pt-5">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-sm font-bold focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">More identifiers<span className="text-sm font-normal text-muted-foreground group-open:hidden">Producer, establishment mark, egg code</span><ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden /></summary>
            <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="manual-producer">Producer</Label><Input id="manual-producer" value={observation.producer ?? ""} onChange={(event) => update("producer", event.target.value)} placeholder="Producer or manufacturer" className="h-11 px-3" /></div>
              <div className="space-y-2"><Label htmlFor="manual-establishment">Establishment mark</Label><Input id="manual-establishment" value={observation.establishmentNumber ?? ""} onChange={(event) => update("establishmentNumber", event.target.value)} placeholder="e.g. UK AB123 EC" className="h-11 px-3" /></div>
              <div className="space-y-2"><Label htmlFor="manual-country">Country of origin</Label><Input id="manual-country" value={observation.countryOfOrigin ?? ""} onChange={(event) => update("countryOfOrigin", event.target.value)} placeholder="e.g. Spain" className="h-11 px-3" /></div>
              <div className="space-y-2"><Label htmlFor="manual-egg">Egg producer code</Label><Input id="manual-egg" value={observation.eggMark?.producerCode ?? ""} onChange={(event) => setObservation((current) => ({ ...current, eggMark: { farmingMethod: current.eggMark?.farmingMethod ?? null, country: current.eggMark?.country ?? null, producerCode: event.target.value || null } }))} placeholder="e.g. 1UK12345" className="h-11 px-3" /></div>
            </div>
          </details>
        </div>
      )}

      <Button disabled={pending || !hasEvidence || barcodeInvalid} variant="solid" size="lg" className="h-13 w-full rounded-full text-base font-bold">{pending ? "Checking published warnings…" : "Check published warnings"}</Button>
      {error ? <p role="alert" className="mt-4 rounded-lg bg-yeet-soft p-4 text-sm font-medium text-yeet">{error}</p> : null}
      <p className="mt-5 text-sm leading-6 text-muted-foreground">This checks published warnings, not whether food is safe to eat.</p>
    </form>
  );
}
