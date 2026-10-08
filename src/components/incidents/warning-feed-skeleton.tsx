export function WarningFeedSkeleton() {
  return (
    <div role="status" aria-label="Loading warnings" className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12">
      <div className="min-w-0 motion-safe:animate-pulse">
        <div className="h-14 rounded-xl border bg-muted/40" />
        <div className="mt-4 flex gap-2 overflow-hidden">{[7, 6, 8, 7].map((width, index) => <div key={index} className="h-10 shrink-0 rounded-full bg-muted" style={{ width: `${width}rem` }} />)}</div>
        <div className="mt-10 h-5 w-48 rounded bg-muted" />
        <ul className="mt-4 border-t">
          {Array.from({ length: 8 }, (_, index) => (
            <li key={index} className="grid grid-cols-[3.25rem_1fr] gap-x-3 border-b py-4 sm:grid-cols-[4.5rem_1fr] sm:gap-x-4">
              <div className="h-4 w-10 rounded bg-muted" />
              <div><div className="h-4 w-11/12 rounded bg-muted" /><div className="mt-2 h-4 w-2/3 rounded bg-muted" /><div className="mt-3 h-4 w-32 rounded-full bg-muted" /></div>
            </li>
          ))}
        </ul>
      </div>
      <div className="hidden h-72 rounded-xl bg-secondary lg:block" />
    </div>
  );
}
