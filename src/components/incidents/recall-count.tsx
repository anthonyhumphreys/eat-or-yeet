/** Animate the arrival of a real count, rather than counting through invented totals. */
export function RecallCount({ value, pending = false }: { value?: number; pending?: boolean }) {
  const text = value?.toLocaleString("en-GB");
  return (
    <span className="recall-count inline-grid overflow-hidden align-bottom tabular-nums" style={{ minWidth: `${Math.max(2, text?.length ?? 2)}ch` }}>
      <span className="sr-only">{pending ? "Updating count" : text ?? "Count unavailable"}</span>
      {pending ? (
        <span key="waiting" aria-hidden="true" className="inline-flex items-center justify-center gap-0.5 self-center py-1.5">
          {[0, 1, 2].map((index) => <span key={index} className="recall-count-dot size-0.5 rounded-full bg-current" style={{ animationDelay: `${index * 80}ms` }} />)}
        </span>
      ) : <span key={text ?? "unknown"} aria-hidden="true" className="recall-count-ready">{text ?? "—"}</span>}
    </span>
  );
}
