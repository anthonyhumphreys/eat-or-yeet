import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t py-7 text-sm text-muted-foreground">
      <div className="page-shell flex flex-wrap items-center justify-between gap-4">
        <p>Official warnings, deterministic matches, zero promises of safety.</p>
        <nav className="flex gap-4" aria-label="Footer navigation">
          <Link className="hover:text-foreground" href="/privacy">Privacy</Link>
          <Link className="hover:text-foreground" href="/incidents">Current warnings</Link>
        </nav>
      </div>
    </footer>
  );
}
