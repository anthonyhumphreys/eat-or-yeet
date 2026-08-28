import { Badge } from "@/components/ui/badge";
import type { MatchableTarget } from "@/lib/domain/types";

export function IncidentTargets({ targets }: { targets: MatchableTarget[] }) {
  if (targets.length === 0) return <p className="text-sm text-muted-foreground">The official source does not provide structured affected-product details.</p>;
  return (
    <ul className="divide-y rounded-xl border">
      {targets.map((target) => (
        <li key={target.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div><p className="font-semibold">{target.value}</p>{target.notes ? <p className="mt-1 text-sm text-muted-foreground">{target.notes}</p> : null}</div>
          <Badge variant="secondary">{target.type.replace(/([A-Z])/g, " $1").toLowerCase()}</Badge>
        </li>
      ))}
    </ul>
  );
}
