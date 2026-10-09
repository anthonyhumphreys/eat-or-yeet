function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameValue(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length
    && keys.every((key) => sameValue(a[key], b[key]));
}

// Compare the fields a patch would write. Fetch/run bookkeeping lives in the
// ingestion ledger; it should not rewrite every unchanged notice each day.
export function sameIncidentContent(existing: Record<string, unknown>, incoming: Record<string, unknown>): boolean {
  return Object.entries(incoming).every(([key, value]) => key === "retrievedAt" || key === "sourceRunId"
    || sameValue(existing[key], value));
}
