import type { MatchableTarget } from "@/lib/domain/types";
import type { TargetType } from "@/lib/domain/schemas";

const labels: Record<TargetType, string> = {
  gtin: "Barcode",
  product: "Product",
  category: "Category",
  brand: "Brand",
  producer: "Producer",
  farm: "Farm",
  batch: "Batch code",
  lot: "Lot code",
  establishment: "Establishment mark",
  approval: "Approval number",
  eggProducerCode: "Egg code",
  country: "Country",
  retailer: "Sold at",
};
const codeTypes = new Set<TargetType>(["gtin", "batch", "lot", "establishment", "approval", "eggProducerCode"]);
const datePrefix = /^affected date information:\s*/i;

/** One block per affected product, with the identifiers you would compare against your pack. */
export function IncidentTargets({ targets }: { targets: MatchableTarget[] }) {
  if (targets.length === 0) return <p className="text-sm text-muted-foreground">The official notice does not list structured product details. Check the official source.</p>;
  const groups = new Map<string, MatchableTarget[]>();
  for (const target of targets) groups.set(target.groupId ?? target.id, [...(groups.get(target.groupId ?? target.id) ?? []), target]);

  return (
    <ul className="divide-y rounded-xl border">
      {[...groups.values()].map((group) => {
        const title = group.find((target) => target.type === "product") ?? group[0];
        const notes = [...new Set(group.map((target) => target.notes?.replace(datePrefix, "")).filter(Boolean))];
        const details = group.filter((target) => target !== title);
        return (
          <li key={title.id} className="p-4 sm:p-5">
            <p className="font-semibold leading-snug">{title.value}</p>
            {details.length || notes.length ? (
              <dl className="mt-3 grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                {details.map((target) => (
                  <div key={target.id} className="contents">
                    <dt className="text-muted-foreground">{labels[target.type as TargetType] ?? target.type}</dt>
                    <dd className={codeTypes.has(target.type as TargetType) ? "font-mono text-[0.8125rem] font-semibold tracking-wide" : "font-medium"}>{target.value}</dd>
                  </div>
                ))}
                {notes.length ? <div className="contents"><dt className="text-muted-foreground">Dates on pack</dt><dd className="font-medium tabular-nums">{notes.join("; ")}</dd></div> : null}
              </dl>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
