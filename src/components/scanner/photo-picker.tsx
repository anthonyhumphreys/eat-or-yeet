"use client";

import { Camera, ImageUp, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ProductObservation } from "@/lib/domain/schemas";

export function PhotoPicker({ onObservation }: { onObservation: (observation: ProductObservation) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyse(file: File) {
    setLoading(true);
    setError(null);
    const body = new FormData();
    body.set("image", file);
    try {
      const response = await fetch("/api/analyse", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Photo analysis failed");
      onObservation(payload.observation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't read that photo.");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="rounded-xl bg-foreground p-6 text-background sm:p-8">
      <div className="mx-auto max-w-md text-center">
        {loading ? <LoaderCircle className="mx-auto size-12 animate-spin text-primary" aria-hidden /> : <Camera className="mx-auto size-12 text-primary" aria-hidden />}
        <h2 className="mt-5 text-2xl font-black">{loading ? "Enhance!" : "Photograph a clear label"}</h2>
        <p className="mt-2 text-sm leading-6 text-background/70">
          {loading ? "Reading visible product details. The original image is discarded after analysis." : "Try the barcode, batch or lot code, producer mark, egg stamp, or use-by date. Sharp and well lit wins."}
        </p>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          capture="environment"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void analyse(file);
          }}
        />
        <Button disabled={loading} onClick={() => inputRef.current?.click()} size="lg" className="mt-6 h-13 rounded-full px-6">
          <ImageUp aria-hidden />{loading ? "Reading the package…" : "Take or choose photo"}
        </Button>
        {error ? <p role="alert" className="mt-4 rounded-lg bg-yeet-soft p-3 text-sm text-yeet">{error}</p> : null}
      </div>
    </div>
  );
}
