import { ArrowRight, ScanBarcode } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <>
      <section className="page-shell grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1fr_.85fr] lg:py-20">
        <div className="max-w-2xl">
          <h1 className="text-5xl font-black leading-[.98] tracking-[-0.035em] sm:text-6xl">Check food against published warnings.</h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">Scan a barcode or enter the details from the pack. We compare them with official UK and US food-safety warnings.</p>
          <div className="mt-8 flex max-w-md flex-col gap-3">
            <Button asChild size="lg" className="tactile h-14 justify-between rounded-full px-6 text-base font-bold">
              <Link href="/scan"><span className="flex items-center gap-3"><ScanBarcode aria-hidden />Scan a barcode</span><ArrowRight aria-hidden /></Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 rounded-full px-6 text-base font-bold">
              <Link href="/search">Enter details manually</Link>
            </Button>
          </div>
          <p className="mt-5 max-w-lg text-sm leading-6 text-muted-foreground">A missing match does not tell you whether food is safe to eat. Always follow the pack and official advice.</p>
        </div>

        <div className="mx-auto w-full max-w-md rounded-xl bg-secondary p-6 sm:p-8">
          <ScanBarcode className="size-10 text-primary" aria-hidden />
          <h2 className="mt-5 text-2xl font-black tracking-tight">A simple check</h2>
          <ol className="mt-6 space-y-5">
            {[
              ["Scan or enter a barcode", "You can add a batch code or other label details too."],
              ["Choose a warning region", "Check published warnings from the UK or US."],
              ["Review the result", "See the matching warning and its official advice."],
            ].map(([title, copy], index) => (
              <li key={title} className="flex gap-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-sm font-bold text-background">{index + 1}</span>
                <div><h3 className="font-bold">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{copy}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t bg-card py-10 sm:py-12">
        <div className="page-shell grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <h2 className="text-xl font-black">Published warnings, clearly scoped</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">UK checks use Food Standards Agency alerts. US checks use FDA and USDA FSIS warnings. Each result shows its checked date, region, and data sources.</p>
          </div>
          <Link href="/incidents" className="inline-flex min-h-11 items-center gap-2 font-bold underline underline-offset-4">Browse warnings<ArrowRight className="size-4" aria-hidden /></Link>
        </div>
      </section>
    </>
  );
}
