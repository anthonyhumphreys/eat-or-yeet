"use client";

import { CameraOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { isValidGtin } from "@/lib/matching/normalise";

type CameraState = "starting" | "scanning" | "unavailable" | "detected";

const nativeFormats = ["ean_13", "ean_8", "upc_a", "upc_e"];
const gtinLengths: Record<string, number> = { ean_13: 13, ean_8: 8, upc_a: 12 };
const cameraConstraints: MediaStreamConstraints = {
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
  audio: false,
};

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
        ? "Camera access is blocked. Allow it in your browser settings, or type the number below."
        : "Camera scanning isn’t available in this browser. Type the number below instead.");
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
          stream = await navigator.mediaDevices.getUserMedia(cameraConstraints);
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

        const { BarcodeFormat, BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        reader.possibleFormats = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E];
        const controls = await reader.decodeFromConstraints(cameraConstraints, video, (result) => {
          if (result) handleCode(result.getText(), BarcodeFormat[result.getBarcodeFormat()].toLowerCase());
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

  const unavailable = cameraState === "unavailable";
  return (
    <div
      className={unavailable
        ? "flex items-start gap-3 rounded-xl border border-dashed bg-muted/50 p-4"
        : "camera-corners relative mx-auto aspect-[4/5] max-h-[min(62svh,26rem)] w-full overflow-hidden rounded-xl bg-black sm:aspect-[16/10]"}
    >
      <video ref={videoRef} muted playsInline className={unavailable ? "hidden" : "size-full object-cover"} aria-label="Live barcode scanner" />
      {unavailable ? (
        <>
          <CameraOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <p role="status" className="text-sm leading-6">{error}</p>
        </>
      ) : (
        <>
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-bold tracking-wide text-white">
            <span className={`size-2 rounded-full ${cameraState === "scanning" ? "bg-primary motion-safe:animate-pulse" : "bg-white/65"}`} />
            {cameraState === "starting" ? "Starting camera" : cameraState === "scanning" ? "Scanning" : "Barcode found"}
          </div>
          {cameraState === "scanning" ? <div className="scan-beam absolute inset-x-[12%] top-1/2 h-px bg-primary shadow-[0_0_12px_var(--primary)]" /> : null}
          {cameraState === "starting" ? (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-white/75">
              <div><div className="mx-auto size-9 rounded-full border-2 border-white/30 border-t-primary motion-safe:animate-spin" aria-hidden /><p className="mt-3 text-sm font-medium">Starting the camera…</p></div>
            </div>
          ) : null}
          {cameraState === "scanning" ? <p className="absolute inset-x-0 bottom-4 text-center text-sm font-medium text-white/85">Line up the bars inside the frame</p> : null}
        </>
      )}
    </div>
  );
}
