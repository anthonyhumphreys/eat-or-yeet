"use client";

import { AlertCircle, CameraOff, Keyboard } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { isValidGtin } from "@/lib/matching/normalise";

type CameraState = "starting" | "scanning" | "unavailable" | "detected";

const nativeFormats = ["ean_13", "ean_8", "upc_a", "upc_e"];
const gtinLengths: Record<string, number> = { ean_13: 13, ean_8: 8, upc_a: 12 };

function expandUpcE(value: string): string | null {
  if (!/^0[0-9]{7}$|^1[0-9]{7}$/.test(value)) return null;
  const numberSystem = value[0];
  const digits = value.slice(1, 7);
  const checkDigit = value[7];
  const last = digits[5];
  let manufacturer: string;
  let product: string;

  if (last === "0" || last === "1" || last === "2") {
    manufacturer = `${digits.slice(0, 2)}${last}00`;
    product = `00${digits.slice(2, 5)}`;
  } else if (last === "3") {
    manufacturer = `${digits.slice(0, 3)}00`;
    product = `000${digits.slice(3, 5)}`;
  } else if (last === "4") {
    manufacturer = `${digits.slice(0, 4)}0`;
    product = `0000${digits[4]}`;
  } else {
    manufacturer = digits.slice(0, 5);
    product = `0000${last}`;
  }

  const upcA = `${numberSystem}${manufacturer}${product}${checkDigit}`;
  return isValidGtin(upcA) ? upcA : null;
}

function normaliseDetectedCode(rawValue: string, format: string): string | null {
  if (!/^[\d\s-]+$/.test(rawValue)) return null;
  const digits = rawValue.replace(/[\s-]/g, "");
  if (format === "upc_e") return expandUpcE(digits);
  if (gtinLengths[format] !== digits.length) return null;
  return isValidGtin(digits) ? digits : null;
}

export function BarcodeCamera({ onDetected }: { onDetected: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handledRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    let zxingControls: { stop(): void } | null = null;

    function stopStream() {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    function reportUnavailable(cause: unknown) {
      if (cancelled) return;
      const denied = cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError");
      setError(denied
        ? "Camera access is blocked. You can still type the barcode or add label details below."
        : "Camera scanning is unavailable here. You can still type the barcode or add label details below.");
      setCameraState("unavailable");
      stopStream();
    }

    function handleCode(rawValue: string, format: string) {
      const value = normaliseDetectedCode(rawValue, format);
      if (!value || handledRef.current || cancelled) return;
      handledRef.current = true;
      setCameraState("detected");
      onDetectedRef.current(value);
    }

    async function start() {
      try {
        const video = videoRef.current;
        if (!video || !navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is unavailable.");

        let supportedFormats: string[] = [];
        if ("BarcodeDetector" in window) {
          try {
            supportedFormats = await BarcodeDetector.getSupportedFormats();
          } catch {
            supportedFormats = [];
          }
        }
        if (cancelled) return;

        const wanted = nativeFormats.filter((format) => supportedFormats.includes(format));
        if ("BarcodeDetector" in window && wanted.length > 0) {
          const detector = new BarcodeDetector({ formats: wanted });
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
          if (cancelled) { stopStream(); return; }
          video.srcObject = stream;
          await video.play();
          if (cancelled) { stopStream(); return; }
          setCameraState("scanning");

          const detect = async () => {
            if (cancelled || handledRef.current) return;
            try {
              const codes = await detector.detect(video);
              for (const code of codes) {
                handleCode(code.rawValue, code.format);
                if (handledRef.current) return;
              }
            } catch {
              // A frame can fail while the camera is warming up.
            }
            if (!cancelled && !handledRef.current) frame = window.setTimeout(detect, 180);
          };
          void detect();
          return;
        }

        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
          if (result) handleCode(result.getText(), result.getBarcodeFormat().toString().toLowerCase());
        });
        if (cancelled) controls.stop();
        else {
          zxingControls = controls;
          setCameraState("scanning");
        }
      } catch (cause) {
        reportUnavailable(cause);
      }
    }

    void start();
    return () => {
      cancelled = true;
      window.clearTimeout(frame);
      zxingControls?.stop();
      stopStream();
    };
  }, []);

  return (
    <div>
      <div className="camera-corners relative aspect-[3/4] overflow-hidden rounded-xl bg-black sm:aspect-video">
        <video ref={videoRef} muted playsInline className="size-full object-cover" aria-label="Live barcode scanner" />
        <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/75 px-3 py-1.5 text-xs font-bold text-white">
          <span className={`size-2 rounded-full ${cameraState === "scanning" ? "bg-primary motion-safe:animate-pulse" : "bg-white/65"}`} />
          {cameraState === "starting" ? "STARTING CAMERA" : cameraState === "scanning" ? "SCANNING" : cameraState === "detected" ? "BARCODE FOUND" : "CAMERA OFF"}
        </div>
        {cameraState === "scanning" ? <div className="scan-beam absolute inset-x-[12%] top-1/2 h-px bg-primary shadow-[0_0_12px_oklch(0.7_0.13_110)]" /> : null}
        {cameraState === "starting" || cameraState === "unavailable" ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-white/75">
            <div>{cameraState === "unavailable" ? <CameraOff className="mx-auto size-10" aria-hidden /> : <div className="mx-auto size-10 animate-pulse rounded-full border-2 border-white/30 border-t-primary" aria-hidden />}
              <p className="mt-3 text-sm font-medium">{cameraState === "starting" ? "Starting the camera…" : error}</p>
            </div>
          </div>
        ) : null}
      </div>
      <p className="mt-4 flex items-start gap-2 text-sm leading-6 text-muted-foreground"><AlertCircle className="mt-1 size-4 shrink-0" aria-hidden />Point the camera at the printed barcode. We only check recognised GTIN barcodes.</p>
      <Link href="/search" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-bold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <Keyboard className="size-4" aria-hidden />Type the barcode instead
      </Link>
    </div>
  );
}
