export const REGION_COOKIE = "eat-or-yeet-region";
export const regionNames = {
  UK: "United Kingdom",
  US: "United States",
} as const;

export type WarningRegion = keyof typeof regionNames;

export function parseRegion(value: unknown): WarningRegion | undefined {
  return typeof value === "string" && Object.hasOwn(regionNames, value) ? value as WarningRegion : undefined;
}
