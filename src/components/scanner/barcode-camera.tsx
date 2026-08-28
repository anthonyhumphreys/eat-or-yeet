"use client";

import { AlertCircle, CameraOff, Keyboard } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export function BarcodeCamera({ onDetected }: { onDetected: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handledRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    let zxingControls: { stop(): void } | null = null;

    async function start() {
      try {
        const video = videoRef.current;
        if (!video) return;
        if ("BarcodeDetector" in window) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
          video.srcObject = stream;
          await video.play();
          const supported = await BarcodeDetector.getSupportedFormats();
          const wanted = ["ean_13", "ean_8", "upc_a", "upc_e", "qr_code"].filter((format) => supported.includes(format));
          const detector = new BarcodeDetector({ formats: wanted });
          const detect = async () => {
            if (cancelled || handledRef.current) return;
            try {
              const codes = await detector.detect(video);
              const value = codes[0]?.rawValue;
              if (value) {
                handledRef.current = true;
                onDetected(value);
                return;
              }
            } catch {
              // A frame can fail while the camera is warming up.
            }
            frame = window.setTimeout(detect, 180);
          };
          detect();
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const reader = new BrowserMultiFormatReader();
          zxingControls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
            if (result && !handledRef.current) {
              handledRef.current = true;
              onDetected(result.getText());
            }
          });
        }
      } catch (cause) {
        if (cancelled) return;
        const denied = cause instanceof DOMException && cause.name === "NotAllowedError";
        setError(denied ? "Camera access was blocked. You can still enter the barcode manually." : "We couldn't start the camera on this device.");
      }
    }

    start();
    return () => {
      cancelled = true;
      window.clearTimeout(frame);
      zxingControls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onDetected]);

  if (error) {
    return (
      <div className="rounded-xl bg-card p-6 text-center">
        <CameraOff className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <h2 className="mt-4 text-xl font-bold">Camera’s off the menu</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{error}</p>
        <Button asChild className="mt-5 rounded-full"><Link href="/search"><Keyboard aria-hidden />Enter details manually</Link></Button>
      </div>
    );
  }

  return (
    <div>
      <div className="camera-corners relative aspect-[3/4] overflow-hidden rounded-xl bg-black sm:aspect-video">
        <video ref={videoRef} muted playsInline className="size-full object-cover" aria-label="Live barcode scanner" />
        <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/65 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-sm"><span className="size-2 rounded-full bg-primary motion-safe:animate-pulse" />SCANNING</div>
        <div className="scan-beam absolute inset-x-[12%] top-1/2 h-px bg-primary shadow-[0_0_12px_oklch(0.7_0.13_110)]" />
      </div>
      <p className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground"><AlertCircle className="size-4" aria-hidden />Hold the barcode inside the frame. Detection is automatic.</p>
    </div>
  );
}
