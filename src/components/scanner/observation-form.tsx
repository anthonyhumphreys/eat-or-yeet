"use client";

import { CheckCircle2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProductObservation } from "@/lib/domain/schemas";

type Field = { key: keyof ProductObservation; label: string; placeholder: string };
const fields: Field[] = [
  { key: "productName", label: "Product", placeholder: "Tesco Free Range Eggs" },
  { key: "brand", label: "Brand", placeholder: "Brand shown on pack" },
  { key: "barcode", label: "Barcode", placeholder: "5000000000000" },
  { key: "batchCode", label: "Batch code", placeholder: "24182" },
  { key: "lotCode", label: "Lot code", placeholder: "LOT A17" },
  { key: "producer", label: "Producer", placeholder: "Producer or manufacturer" },
  { key: "establishmentNumber", label: "Establishment mark", placeholder: "UK AB123 EC" },
  { key: "countryOfOrigin", label: "Country of origin", placeholder: "United Kingdom" },
];

export function ObservationForm({ observation, onSubmit, submitLabel = "Check this", pending = false, heading = "Here’s what we found", description = "Correct anything the camera misread before we check the warnings." }: { observation: ProductObservation; onSubmit: (observation: ProductObservation) => void; submitLabel?: string; pending?: boolean; heading?: string; description?: string }) {
  const [values, setValues] = useState(observation);
  return (
    <form
      className="rounded-xl border bg-card p-5 sm:p-7"
      onSubmit={(event) => { event.preventDefault(); onSubmit(values); }}
    >
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-1 size-6 shrink-0 text-primary" aria-hidden />
        <div><h2 className="text-2xl font-black">{heading}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {fields.map(({ key, label, placeholder }) => (
          <div key={key} className="space-y-2">
            <Label htmlFor={key}>{label}</Label>
            <Input
              id={key}
              name={key}
              value={typeof values[key] === "string" ? values[key] ?? "" : ""}
              placeholder={placeholder}
              inputMode={key === "barcode" ? "numeric" : "text"}
              onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value || null }))}
            />
          </div>
        ))}
        <div className="space-y-2">
          <Label htmlFor="eggProducerCode">Egg producer code</Label>
          <Input id="eggProducerCode" value={values.eggMark?.producerCode ?? ""} placeholder="1UK12345" onChange={(event) => setValues((current) => ({ ...current, eggMark: { farmingMethod: current.eggMark?.farmingMethod ?? null, country: current.eggMark?.country ?? null, producerCode: event.target.value || null } }))} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="useBy">Use-by or best-before</Label>
          <Input id="useBy" value={values.dates?.useBy ?? values.dates?.bestBefore ?? ""} placeholder="2026-09-04" onChange={(event) => setValues((current) => ({ ...current, dates: { useBy: event.target.value || null, bestBefore: null, productionDate: current.dates?.productionDate ?? null } }))} />
        </div>
      </div>
      <Button disabled={pending} size="lg" className="tactile mt-6 h-13 w-full rounded-full text-base font-bold">{pending ? "Checking the food-safety receipts…" : submitLabel}</Button>
    </form>
  );
}
