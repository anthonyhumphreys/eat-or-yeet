"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { BarcodeField } from "@/components/scanner/barcode-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidGtin } from "@/lib/domain/gtin";
import type { ProductObservation } from "@/lib/domain/schemas";

type Field = { key: keyof ProductObservation; label: string; placeholder: string; wide?: boolean };
const fields: Field[] = [
  { key: "productName", label: "Product name", placeholder: "e.g. Mozzarella pearls", wide: true },
  { key: "brand", label: "Brand", placeholder: "" },
  { key: "barcode", label: "Barcode", placeholder: "" },
  { key: "batchCode", label: "Batch code", placeholder: "e.g. 24182" },
  { key: "lotCode", label: "Lot code", placeholder: "e.g. LOT A17" },
];

const advancedFields: Field[] = [
  { key: "producer", label: "Producer", placeholder: "Producer or manufacturer" },
  { key: "farmCode", label: "Farm code", placeholder: "Farm code on pack" },
  { key: "establishmentNumber", label: "Establishment mark", placeholder: "e.g. UK AB123 EC" },
  { key: "approvalNumber", label: "Approval number", placeholder: "Approval number on pack" },
  { key: "retailer", label: "Retailer", placeholder: "Retailer name" },
  { key: "category", label: "Food category", placeholder: "Product category" },
  { key: "countryOfOrigin", label: "Country of origin", placeholder: "e.g. Spain" },
];

export function ObservationForm({ observation, onSubmit, submitLabel = "Check published warnings", pending = false, heading, description }: { observation: ProductObservation; onSubmit: (observation: ProductObservation) => void; submitLabel?: string; pending?: boolean; heading?: string; description?: string }) {
  const [values, setValues] = useState(observation);
  const barcode = values.barcode ?? "";
  const barcodeInvalid = Boolean(barcode) && !isValidGtin(barcode);
  const hasEvidence = Boolean(values.productName || values.brand || values.barcode || values.batchCode || values.lotCode || values.producer || values.farmCode || values.establishmentNumber || values.approvalNumber || values.retailer || values.category || values.countryOfOrigin || values.eggMark?.producerCode);
  const dateValue = values.dates?.useBy ?? values.dates?.bestBefore ?? "";

  return (
    <form
      className="rounded-xl border bg-card p-5 sm:p-7"
      onSubmit={(event) => { event.preventDefault(); onSubmit(values); }}
    >
      {heading ? <div className="mb-6"><h2 className="text-xl font-black">{heading}</h2>{description ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p> : null}</div> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(({ key, label, placeholder, wide }) => key === "barcode" ? (
          <BarcodeField key={key} id="observation-barcode" value={barcode} onChange={(value) => setValues((current) => ({ ...current, barcode: value || null }))} optional size="md" />
        ) : (
          <div key={key} className={`space-y-2 ${wide ? "sm:col-span-2" : ""}`}>
            <Label htmlFor={`observation-${key}`}>{label}</Label>
            <Input
              id={`observation-${key}`}
              name={key}
              value={typeof values[key] === "string" ? values[key] ?? "" : ""}
              placeholder={placeholder || undefined}
              onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value || null }))}
            />
          </div>
        ))}
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="observation-date">Use-by or best-before</Label>
          <Input
            id="observation-date"
            name="date"
            type="date"
            value={dateValue}
            onChange={(event) => setValues((current) => ({ ...current, dates: { useBy: event.target.value || null, bestBefore: null, productionDate: current.dates?.productionDate ?? null } }))}
          />
        </div>
      </div>

      <details className="group mt-6 border-t pt-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-sm font-bold focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">More identifiers<ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden /></summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {advancedFields.map(({ key, label, placeholder }) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={`observation-${key}`}>{label}</Label>
              <Input id={`observation-${key}`} name={key} value={typeof values[key] === "string" ? values[key] ?? "" : ""} placeholder={placeholder} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value || null }))} />
            </div>
          ))}
          <div className="space-y-2">
            <Label htmlFor="observation-egg-code">Egg producer code</Label>
            <Input id="observation-egg-code" name="eggProducerCode" value={values.eggMark?.producerCode ?? ""} placeholder="e.g. 1UK12345" onChange={(event) => setValues((current) => ({ ...current, eggMark: { farmingMethod: current.eggMark?.farmingMethod ?? null, country: current.eggMark?.country ?? null, producerCode: event.target.value || null } }))} />
          </div>
        </div>
      </details>

      <Button disabled={pending || !hasEvidence || barcodeInvalid} variant="solid" size="lg" className="mt-6 h-13 w-full rounded-full text-base font-bold">{pending ? "Checking published warnings…" : submitLabel}</Button>
    </form>
  );
}
