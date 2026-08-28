import { ScanLine } from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="border-b bg-background/95 supports-[backdrop-filter]:bg-background/85 supports-[backdrop-filter]:backdrop-blur">
      <div className="page-shell flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-black tracking-[-0.025em]" aria-label="Eat or Yeet home">
          <span className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground"><ScanLine className="size-5" aria-hidden /></span>
          <span>Eat or Yeet</span>
        </Link>
        <nav className="flex items-center gap-1" aria-label="Main navigation">
          <Link className="rounded-md px-2 py-2 text-sm font-medium hover:bg-muted sm:px-3" href="/incidents">Warnings</Link>
          <Link className="hidden rounded-md px-3 py-2 text-sm font-medium hover:bg-muted sm:block" href="/search">Search</Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
