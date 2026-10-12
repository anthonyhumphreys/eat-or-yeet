import { Puzzle, ScanBarcode } from "lucide-react";
import Link from "next/link";

import { BrandTile } from "@/components/brand-logo";
import { LocationSelect } from "@/components/location-select";
import { ThemeToggle } from "@/components/theme-toggle";

const navLink = "min-h-10 items-center rounded-full px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export function SiteHeader() {
  return (
    <header className="border-b bg-background">
      <div className="page-shell flex h-16 items-center gap-1 sm:gap-2 lg:gap-3">
        <Link href="/" className="mr-auto flex min-h-11 items-center gap-2.5 rounded-xl pr-1 text-[1.0625rem] font-black tracking-tight focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Eat or Yeet home">
          <BrandTile className="size-9" />
          <span className="hidden min-[480px]:inline">Eat or Yeet</span>
        </Link>
        <nav className="flex shrink-0 items-center gap-1" aria-label="Main navigation">
          <Link className={`${navLink} hidden md:inline-flex`} href="/">Recalls</Link>
          <Link className={`${navLink} inline-flex`} href="/integrations" title="Integrations">
            <Puzzle className="size-4 md:hidden" aria-hidden />
            <span className="sr-only md:not-sr-only">Integrations</span>
          </Link>
        </nav>
        <LocationSelect />
        <ThemeToggle />
        {/* One way into checking a pack, from every page. The check page links on to the camera. */}
        <Link
          href="/search"
          aria-label="Check a product"
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full bg-primary px-3.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-4"
        >
          <ScanBarcode className="hidden size-4 sm:block" aria-hidden />
          <span className="sm:hidden">Check</span>
          <span className="hidden sm:inline">Check a product</span>
        </Link>
      </div>
    </header>
  );
}
