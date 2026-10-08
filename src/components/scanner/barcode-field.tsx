"use client";

import { CircleAlert, CircleCheck } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidGtin } from "@/lib/domain/gtin";

const lengths = [8, 12, 13, 14];

export function barcodeStatus(value: string) {
  const digits = value.replace(/[\s-]/g, "");
  if (!digits) return { state: "empty" as const, digits };
  if (/\D/.test(digits)) return { state: "error" as const, digits, message: "Use digits only." };
  if (isValidGtin(digits)) return { state: "valid" as const, digits };
  if (lengths.includes(digits.length)) return { state: "error" as const, digits, message: "That number doesn’t add up. Check the last digit." };
  if (digits.length > 14) return { state: "error" as const, digits, message: "Too long. Barcodes have at most 14 digits." };
  return { state: "typing" as const, digits };
}

/** A barcode input that confirms the check digit as you type, so mistakes surface before the check. */
export function BarcodeField({ id, value, onChange, label = "Barcode number", optional = false, size = "lg", autoFocus = false }: { id: string; value: string; onChange: (value: string) => void; label?: string; optional?: boolean; size?: "lg" | "md"; autoFocus?: boolean }) {
  const status = barcodeStatus(value);
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className={size === "lg" ? "text-base font-bold" : undefined}>{label}{optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}</Label>
      <div className="relative">
        <Input
          id={id}
          name="barcode"
          inputMode="numeric"
          autoComplete="off"
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={status.state === "error"}
          aria-describedby={hintId}
          className={size === "lg" ? "h-14 pr-12 pl-4 font-mono text-lg tracking-[0.08em] tabular-nums md:text-lg" : "h-11 pr-10 pl-3 font-mono tracking-[0.06em] tabular-nums"}
        />
        {status.state === "valid" ? <CircleCheck className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-primary motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:fade-in" aria-hidden /> : null}
      </div>
      <p id={hintId} aria-live="polite" className={`flex items-start gap-1.5 text-sm leading-6 ${status.state === "error" ? "font-semibold text-yeet" : "text-muted-foreground"}`}>
        {status.state === "error" ? <CircleAlert className="mt-1 size-4 shrink-0" aria-hidden /> : null}
        {status.state === "empty" ? "The 8 to 14 digits printed under the bars."
          : status.state === "typing" ? <span className="tabular-nums">{status.digits.length} {status.digits.length === 1 ? "digit" : "digits"} so far. Most packs have 13.</span>
            : status.state === "valid" ? <span className="font-semibold text-foreground">Valid {status.digits.length}-digit barcode.</span>
              : status.message}
      </p>
    </div>
  );
}
