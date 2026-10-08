import { ScanBarcode, ScanLine } from "lucide-react";
import Link from "next/link";

import { LocationSelect } from "@/components/location-select";
import { ThemeToggle } from "@/components/theme-toggle";

const navLink = "inline-flex min-h-10 items-center rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export function SiteHeader() {
  return (
    <header className="border-b bg-background">
      <div className="page-shell flex h-16 items-center gap-2 sm:gap-4">
        <Link href="/" className="mr-auto flex min-h-11 items-center gap-2 rounded-full pr-1 font-black tracking-tight focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Eat or Yeet home">
          <span className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground"><ScanLine className="size-[1.125rem]" aria-hidden /></span>
          <span className="hidden min-[360px]:inline">Eat or Yeet</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
          <Link className={navLink} href="/">Warnings</Link>
          <Link className={navLink} href="/search">Type a barcode</Link>
          <Link className="ml-1 inline-flex min-h-10 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-bold text-background transition-colors hover:bg-foreground/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href="/scan"><ScanBarcode className="size-4" aria-hidden />Scan food</Link>
        </nav>
        <LocationSelect />
        <ThemeToggle />
      </div>
    </header>
  );
}
