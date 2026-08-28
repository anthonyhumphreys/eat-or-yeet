import { Camera, Check, ChevronRight, CircleHelp, ScanBarcode, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <>
      <section className="page-shell grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.05fr_.95fr] lg:py-16">
        <div className="max-w-2xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-sm font-semibold">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            Checks official UK and US warnings
          </div>
          <h1 className="text-6xl font-black leading-[0.9] tracking-[-0.04em] sm:text-7xl">Eat or Yeet?</h1>
          <p className="mt-6 max-w-xl text-xl font-semibold leading-8">Scan it. Check it. Eat it or yeet it.</p>
          <p className="mt-3 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            Not sure whether that package is caught up in a recall? Show us the label and we&apos;ll check current official warnings.
          </p>
          <div className="mt-8 flex max-w-md flex-col gap-3">
            <Button asChild size="lg" className="tactile h-14 justify-between rounded-full px-6 text-base font-bold">
              <Link href="/scan?mode=barcode"><span className="flex items-center gap-3"><ScanBarcode aria-hidden />Scan my food</span><ChevronRight aria-hidden /></Link>
            </Button>
            <Button asChild size="lg" variant="secondary" className="h-14 justify-between rounded-full px-6 text-base font-bold">
              <Link href="/scan?mode=photo"><span className="flex items-center gap-3"><Camera aria-hidden />Take a photo</span><ChevronRight aria-hidden /></Link>
            </Button>
            <Button asChild variant="link" className="self-start px-1 text-foreground">
              <Link href="/search"><Search aria-hidden />Enter details manually</Link>
            </Button>
          </div>
        </div>

        <div className="camera-corners relative mx-auto aspect-[4/5] w-full max-w-md overflow-hidden rounded-xl bg-black text-white">
          <div className="absolute inset-x-5 top-5 z-10 flex items-center justify-between text-[0.7rem] font-bold tracking-[0.12em] text-white/70">
            <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-primary motion-safe:animate-pulse" />CAMERA READY</span>
            <span>OFFICIAL DATA</span>
          </div>
          <div className="absolute inset-0 grid place-items-center p-8 text-center">
            <div><ScanBarcode className="mx-auto mb-5 size-20 text-primary" strokeWidth={1.5} aria-hidden /><p className="text-3xl font-black tracking-tight">Let&apos;s check the label.</p><p className="mt-3 max-w-xs text-sm leading-6 text-white/70">Point your camera at a barcode, batch code, producer mark, or the clearest part of the label.</p></div>
          </div>
          <div className="scan-beam absolute inset-x-8 top-[34%] h-px bg-primary shadow-[0_0_12px_oklch(0.7_0.13_110)]" />
          <p className="absolute inset-x-5 bottom-5 text-center text-[0.7rem] font-bold tracking-[0.12em] text-white/55">UK + USA · SELECT BEFORE SCANNING</p>
        </div>
      </section>

      <section className="border-y bg-card py-14">
        <div className="page-shell">
          <h2 className="text-3xl font-black tracking-tight">How it works</h2>
          <ol className="mt-8 grid gap-7 md:grid-cols-3">
            {[
              ["1", "Scan your food", "Use a barcode or photograph the useful details on the packaging."],
              ["2", "We check the receipts", "Deterministic rules compare the details with official current warnings."],
              ["3", "Get the verdict", "See what matched, how strong it is, and the authority’s advice."],
            ].map(([number, title, copy]) => (
              <li key={number} className="flex gap-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground font-bold text-background">{number}</span>
                <div><h3 className="font-bold">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{copy}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="page-shell py-14">
        <h2 className="text-3xl font-black tracking-tight">Four honest answers. No fake certainty.</h2>
        <div className="mt-8 divide-y overflow-hidden rounded-xl border">
          <div className="flex gap-4 bg-eat-soft p-5"><Check className="mt-0.5 size-6 shrink-0 text-eat" aria-hidden /><div><h3 className="font-black">EAT</h3><p className="text-sm text-muted-foreground">No current matching warning found. This is not a guarantee of safety.</p></div></div>
          <div className="flex gap-4 bg-maybe-soft p-5"><TriangleAlert className="mt-0.5 size-6 shrink-0 text-maybe" aria-hidden /><div><h3 className="font-black">MAYBE YEET</h3><p className="text-sm text-muted-foreground">Something matches, but we need more evidence.</p></div></div>
          <div className="flex gap-4 bg-yeet-soft p-5"><TriangleAlert className="mt-0.5 size-6 shrink-0 text-yeet" aria-hidden /><div><h3 className="font-black">YEET</h3><p className="text-sm text-muted-foreground">Your product, batch, or producer strongly matches a current warning.</p></div></div>
          <div className="flex gap-4 bg-muted p-5"><CircleHelp className="mt-0.5 size-6 shrink-0 text-foreground" aria-hidden /><div><h3 className="font-black">NO CLUE</h3><p className="text-sm text-muted-foreground">There is not enough evidence to make a useful comparison.</p></div></div>
        </div>
      </section>
    </>
  );
}
