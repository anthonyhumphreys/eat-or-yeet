"use client";

import { Keyboard, ScanBarcode } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// In a shop aisle the check is a thumb's reach away; the check routes themselves don't need it.
export function MobileCheckBar() {
  const pathname = usePathname();
  if (pathname === "/scan" || pathname === "/search") return null;
  return (
    <>
      <div className="h-20 md:hidden" aria-hidden />
      <nav aria-label="Check food" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 px-4 pt-3 backdrop-blur-md md:hidden">
        <div className="mx-auto flex max-w-md gap-2">
          <Link href="/scan" className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-foreground text-[0.9375rem] font-bold text-background active:scale-[0.98] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:transition-transform">
            <ScanBarcode className="size-5" aria-hidden />Scan food
          </Link>
          <Link href="/search" aria-label="Type a barcode" className="grid min-h-12 w-14 place-items-center rounded-full border bg-background active:scale-[0.96] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:transition-transform">
            <Keyboard className="size-5" aria-hidden />
          </Link>
        </div>
      </nav>
    </>
  );
}
