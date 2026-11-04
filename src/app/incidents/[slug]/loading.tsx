export default function LoadingRecall() {
  return (
    <div role="status" aria-label="Loading recall details" className="page-shell py-6 sm:py-10">
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="mb-6 h-5 w-32 rounded bg-muted" />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
          <div>
            <div className="h-5 w-48 rounded-full bg-muted" />
            <div className="mt-4 h-24 rounded-lg bg-muted/60" />
            <div className="mt-3 h-14 rounded-lg bg-muted/40" />
            <div className="mt-7 h-64 rounded-xl bg-yeet-soft" />
            <div className="mt-10 h-6 w-40 rounded bg-muted" />
            <div className="mt-4 h-32 rounded-xl bg-muted/40" />
          </div>
          <div className="hidden h-96 rounded-xl border bg-card lg:block" />
        </div>
      </div>
    </div>
  );
}
