import Link from "next/link";
import { AnalyticsPreferencesButton } from "./analytics-consent";

export function SiteFooter() {
  return (
    <footer className="border-t py-7 text-sm text-muted-foreground">
      <div className="page-shell flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-1">Provided by <Link className="underline underline-offset-4" href="/terms">Lexio Apps Ltd</Link>.</p>
          <p>Published warning checks with the source, date, and region shown.</p>
          <p className="mt-1">
            Created by{" "}
            <a href="https://twitter.com/Alykkat" target="_blank" rel="noopener noreferrer" aria-label="@Alykkat on Twitter, opens in a new tab" className="inline-block rounded-sm py-1 underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">@Alykkat</a>
            {" "}and{" "}
            <a href="https://twitter.com/aphumphreys" target="_blank" rel="noopener noreferrer" aria-label="@aphumphreys on Twitter, opens in a new tab" className="inline-block rounded-sm py-1 underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">@aphumphreys</a>
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Footer navigation">
          <AnalyticsPreferencesButton />
          <Link className="inline-flex min-h-11 items-center rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href="/privacy">Privacy</Link>
          <Link className="inline-flex min-h-11 items-center rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href="/terms">Terms</Link>
          <Link className="inline-flex min-h-11 items-center rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href="/support">Support</Link>
          <Link className="inline-flex min-h-11 items-center rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href="/incidents">Current warnings</Link>
          <Link className="inline-flex min-h-11 items-center rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href="/integrations">Integrations</Link>
        </nav>
      </div>
    </footer>
  );
}
