import { ScanBarcode, ScanLine, Search } from "lucide-react";
import Link from "next/link";

import { LocationToggle } from "@/components/location-toggle";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="border-b bg-background">
      <div className="page-shell flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
        <Link href="/" className="flex min-h-11 items-center gap-2 font-black tracking-tight" aria-label="Eat or Yeet home">
          <span className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground"><ScanLine className="size-5" aria-hidden /></span>
          <span>Eat or Yeet</span>
        </Link>
        <div className="flex items-center gap-2 sm:order-last">
          <LocationToggle />
          <ThemeToggle />
        </div>
        <nav className="flex w-full items-center justify-between gap-1 border-t pt-2 sm:w-auto sm:border-0 sm:pt-0" aria-label="Main navigation">
          <div className="flex items-center gap-1">
            <Link className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-muted" href="/incidents">Warnings</Link>
            <Link className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-muted" href="/#warnings"><Search className="size-4" aria-hidden />Search warnings</Link>
          </div>
          <Link className="inline-flex min-h-11 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-bold text-background focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href="/scan"><ScanBarcode className="size-4" aria-hidden />Check my food</Link>
        </nav>
      </div>
    </header>
  );
}
