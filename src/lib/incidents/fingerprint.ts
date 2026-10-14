function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, ordered(item)]));
  }
  return value;
}

// Hash persisted content, including the original source, independently of the
// daily fetch ledger. Source payloads and stored records use JSON values.
export async function incidentFingerprint(item: Record<string, unknown>): Promise<string> {
  const content = Object.fromEntries(Object.entries(item)
    .filter(([key]) => !["retrievedAt", "sourceRunId", "_id", "_creationTime"].includes(key)));
  const bytes = new TextEncoder().encode(JSON.stringify(ordered(content)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `v1:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
