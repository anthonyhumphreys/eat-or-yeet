import { ScanBarcode, ScanLine, Search } from "lucide-react";
import Link from "next/link";

import { LocationToggle } from "@/components/location-toggle";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="border-b bg-background">
      <div className="page-shell flex flex-wrap items-center justify-between gap-x-2 gap-y-2 py-3 sm:gap-x-4">
        <Link href="/" className="flex min-h-11 items-center gap-2 font-black tracking-tight" aria-label="Eat or Yeet home">
          <span className="hidden size-8 place-items-center rounded-full bg-primary text-primary-foreground min-[360px]:grid sm:size-9"><ScanLine className="size-5" aria-hidden /></span>
          <span>Eat or Yeet</span>
        </Link>
        <div className="flex items-center gap-1 sm:gap-2 lg:order-last">
          <LocationToggle />
          <ThemeToggle />
        </div>
        <nav className="flex w-full items-center justify-between gap-1 border-t pt-2 lg:w-auto lg:border-0 lg:pt-0" aria-label="Main navigation">
          <div className="flex items-center gap-1">
            <Link className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-3" href="/incidents">Warnings</Link>
            <Link aria-label="Search warnings" className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-3" href="/#warnings"><Search className="size-4" aria-hidden />Search<span className="hidden sm:inline">warnings</span></Link>
          </div>
          <Link className="inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-foreground px-3 text-sm font-bold text-background focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-4" href="/scan"><ScanBarcode className="hidden size-4 sm:block" aria-hidden />Check my food</Link>
        </nav>
      </div>
    </header>
  );
}
