export function WarningFeedSkeleton() {
  return (
    <div role="status" aria-label="Loading recalls" className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
      <div className="min-w-0 motion-safe:animate-pulse">
        <div className="h-24 rounded-xl border bg-muted/40 sm:h-36" />
        <div className="mt-6 flex gap-2 overflow-hidden">{[5, 7, 8, 8, 6].map((width, index) => <div key={index} className="h-10 shrink-0 rounded-full bg-muted" style={{ width: `${width}rem` }} />)}</div>
        <div className="mt-3 h-12 rounded-xl border bg-muted/40" />
        <div className="mt-8 h-5 w-48 rounded bg-muted" />
        <ul className="mt-4 border-t">
          {Array.from({ length: 8 }, (_, index) => (
            <li key={index} className="grid grid-cols-1 gap-x-4 border-b py-4 sm:grid-cols-[6.75rem_1fr]">
              <div className="hidden h-4 w-20 rounded bg-muted sm:block" />
              <div><div className="h-4 w-11/12 rounded bg-muted" /><div className="mt-2 h-4 w-2/3 rounded bg-muted" /><div className="mt-3 h-4 w-32 rounded-full bg-muted" /></div>
            </li>
          ))}
        </ul>
      </div>
      <div className="hidden h-96 rounded-xl bg-muted/60 lg:block" />
    </div>
  );
}
