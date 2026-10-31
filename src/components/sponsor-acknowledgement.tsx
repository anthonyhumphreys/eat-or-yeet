import Image from "next/image";

export function SponsorAcknowledgement() {
  return (
    <aside aria-label="Project sponsor" className="border-b bg-muted/40">
      <div className="page-shell flex min-h-11 flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground sm:justify-start">
        <span>Sponsored by</span>
        <a
          href="https://www.firecrawl.dev/"
          target="_blank"
          rel="sponsored noopener noreferrer"
          aria-label="Firecrawl, project sponsor, opens in a new tab"
          className="inline-flex min-h-11 items-center rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Image src="/sponsors/firecrawl-light.svg" alt="Firecrawl" width={172} height={40} className="h-7 w-auto dark:hidden" unoptimized />
          <Image src="/sponsors/firecrawl-dark.svg" alt="" width={172} height={40} className="hidden h-7 w-auto dark:block" unoptimized />
        </a>
        <span className="hidden sm:inline">Thank you for supporting Eat or Yeet.</span>
      </div>
    </aside>
  );
}
