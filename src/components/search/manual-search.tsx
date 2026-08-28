"use client";

import { PackageSearch, ScanBarcode, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VerdictView } from "@/components/verdict/verdict-view";
import { emptyObservation, type ProductObservation } from "@/lib/domain/schemas";
import type { VerdictResult } from "@/lib/domain/types";

type SearchMode = "barcode" | "details";

export function ManualSearch() {
  const router = useRouter();
  const [region, setRegion] = useState<"UK" | "US">("UK");
  const [mode, setMode] = useState<SearchMode>("barcode");
  const [observation, setObservation] = useState<ProductObservation>(emptyObservation());
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<VerdictResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update(key: keyof ProductObservation, value: string) {
    setObservation((current) => ({ ...current, [key]: value || null }));
  }

  const hasEvidence = mode === "barcode"
    ? Boolean(observation.barcode)
    : Boolean(observation.productName || observation.brand || observation.batchCode || observation.lotCode || observation.producer || observation.establishmentNumber || observation.eggMark?.producerCode);

  async function check(observation: ProductObservation) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ observation, region }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Search failed");
      setResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search failed.");
    } finally {
      setPending(false);
    }
  }

  if (result) return <VerdictView result={result} onReset={() => { setResult(null); setObservation(emptyObservation()); }} onAddPhoto={() => router.push("/scan?mode=photo")} onEdit={() => setResult(null)} />;

  return (
    <form onSubmit={(event) => { event.preventDefault(); void check(observation); }}>
      <div className="max-w-xl">
        <h1 className="text-4xl font-black tracking-[-0.035em] sm:text-5xl">Search food warnings</h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">Start with a barcode. If you do not have one, add the clearest details from the label.</p>
      </div>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-5 border-y py-5">
        <fieldset>
          <legend className="text-sm font-semibold text-muted-foreground">Official warnings from</legend>
          <div className="mt-2 flex rounded-full bg-muted p-1">
            {(["UK", "US"] as const).map((item) => <button key={item} type="button" onClick={() => setRegion(item)} className={`min-h-9 rounded-full px-5 text-sm font-bold transition-colors ${region === item ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`} aria-pressed={region === item}>{item}</button>)}
          </div>
        </fieldset>
        <div className="flex rounded-full border p-1" role="tablist" aria-label="Search method">
          <button type="button" role="tab" aria-selected={mode === "barcode"} onClick={() => setMode("barcode")} className={`flex min-h-9 items-center gap-2 rounded-full px-4 text-sm font-bold transition-colors ${mode === "barcode" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground"}`}><ScanBarcode className="size-4" aria-hidden />Barcode</button>
          <button type="button" role="tab" aria-selected={mode === "details"} onClick={() => setMode("details")} className={`flex min-h-9 items-center gap-2 rounded-full px-4 text-sm font-bold transition-colors ${mode === "details" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground"}`}><PackageSearch className="size-4" aria-hidden />Label details</button>
        </div>
      </div>

      {mode === "barcode" ? (
        <div className="py-8">
          <Label htmlFor="manual-barcode" className="text-base font-bold">Barcode number</Label>
          <Input id="manual-barcode" name="barcode" inputMode="numeric" autoComplete="off" value={observation.barcode ?? ""} onChange={(event) => update("barcode", event.target.value)} placeholder="860014523113" className="mt-3 h-14 px-4 text-lg font-semibold tabular-nums md:text-lg" />
          <p className="mt-3 text-sm text-muted-foreground">Enter the digits printed beneath the barcode.</p>
        </div>
      ) : (
        <div className="py-8">
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="manual-product">Product</Label><Input id="manual-product" value={observation.productName ?? ""} onChange={(event) => update("productName", event.target.value)} placeholder="Alfalfa sprouts" className="h-11 px-3" /></div>
            <div className="space-y-2"><Label htmlFor="manual-brand">Brand</Label><Input id="manual-brand" value={observation.brand ?? ""} onChange={(event) => update("brand", event.target.value)} placeholder="Everything Sprouts" className="h-11 px-3" /></div>
            <div className="space-y-2"><Label htmlFor="manual-producer">Producer</Label><Input id="manual-producer" value={observation.producer ?? ""} onChange={(event) => update("producer", event.target.value)} placeholder="Producer or manufacturer" className="h-11 px-3" /></div>
            <div className="space-y-2"><Label htmlFor="manual-batch">Batch code</Label><Input id="manual-batch" value={observation.batchCode ?? ""} onChange={(event) => update("batchCode", event.target.value)} placeholder="24182" className="h-11 px-3" /></div>
            <div className="space-y-2"><Label htmlFor="manual-lot">Lot code</Label><Input id="manual-lot" value={observation.lotCode ?? ""} onChange={(event) => update("lotCode", event.target.value)} placeholder="222" className="h-11 px-3" /></div>
          </div>

          <details className="mt-6 border-t pt-5">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-bold focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><SlidersHorizontal className="size-4" aria-hidden />More identifiers</summary>
            <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="manual-establishment">Establishment mark</Label><Input id="manual-establishment" value={observation.establishmentNumber ?? ""} onChange={(event) => update("establishmentNumber", event.target.value)} placeholder="UK AB123 EC" className="h-11 px-3" /></div>
              <div className="space-y-2"><Label htmlFor="manual-country">Country of origin</Label><Input id="manual-country" value={observation.countryOfOrigin ?? ""} onChange={(event) => update("countryOfOrigin", event.target.value)} placeholder="United States" className="h-11 px-3" /></div>
              <div className="space-y-2"><Label htmlFor="manual-egg">Egg producer code</Label><Input id="manual-egg" value={observation.eggMark?.producerCode ?? ""} onChange={(event) => setObservation((current) => ({ ...current, eggMark: { farmingMethod: current.eggMark?.farmingMethod ?? null, country: current.eggMark?.country ?? null, producerCode: event.target.value || null } }))} placeholder="1UK12345" className="h-11 px-3" /></div>
              <div className="space-y-2"><Label htmlFor="manual-date">Use-by or best-before</Label><Input id="manual-date" value={observation.dates?.useBy ?? observation.dates?.bestBefore ?? ""} onChange={(event) => setObservation((current) => ({ ...current, dates: { useBy: event.target.value || null, bestBefore: null, productionDate: current.dates?.productionDate ?? null } }))} placeholder="2026-09-04" className="h-11 px-3" /></div>
            </div>
          </details>
        </div>
      )}

      <Button disabled={pending || !hasEvidence} size="lg" className="tactile h-13 w-full rounded-full text-base font-bold">{pending ? "Checking official warnings…" : mode === "barcode" ? "Check barcode" : "Check these details"}</Button>
      {error ? <p role="alert" className="mt-4 rounded-lg bg-yeet-soft p-4 text-sm font-medium text-yeet">{error}</p> : null}
    </form>
  );
}
