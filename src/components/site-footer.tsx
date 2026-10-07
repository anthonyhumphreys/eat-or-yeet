import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t py-7 text-sm text-muted-foreground">
      <div className="page-shell flex flex-wrap items-center justify-between gap-4">
        <p>Published warning checks with the source, date, and region shown.</p>
        <nav className="flex gap-4" aria-label="Footer navigation">
          <Link className="hover:text-foreground" href="/privacy">Privacy</Link>
          <Link className="hover:text-foreground" href="/incidents">Current warnings</Link>
        </nav>
      </div>
    </footer>
  );
}
