export const REGION_COOKIE = "eat-or-yeet-region";
export const regionNames = {
  UK: "United Kingdom",
  US: "United States",
} as const;

export type WarningRegion = keyof typeof regionNames;

export function parseRegion(value: unknown): WarningRegion | undefined {
  return typeof value === "string" && Object.hasOwn(regionNames, value) ? value as WarningRegion : undefined;
}

export function regionFromCountryCode(value: string | null): WarningRegion | undefined {
  if (value === "GB") return "UK";
  if (value === "US") return "US";
  return undefined;
}

const usTimeZones = new Set([
  "America/New_York", "America/Detroit", "America/Kentucky/Louisville", "America/Kentucky/Monticello",
  "America/Indiana/Indianapolis", "America/Indiana/Vincennes", "America/Indiana/Winamac", "America/Indiana/Marengo",
  "America/Indiana/Petersburg", "America/Indiana/Vevay", "America/Indiana/Tell_City", "America/Indiana/Knox",
  "America/Chicago", "America/Menominee", "America/North_Dakota/Center", "America/North_Dakota/New_Salem",
  "America/North_Dakota/Beulah", "America/Denver", "America/Boise", "America/Phoenix", "America/Los_Angeles",
  "America/Anchorage", "America/Juneau", "America/Sitka", "America/Metlakatla", "America/Yakutat", "America/Nome",
  "America/Adak", "Pacific/Honolulu", "US/Eastern", "US/Central", "US/Mountain", "US/Pacific", "US/Alaska",
  "US/Aleutian", "US/Arizona", "US/Hawaii", "US/Indiana-Starke", "US/East-Indiana", "US/Michigan",
]);

export function suggestBrowserRegion(languages: readonly string[], timeZone: string): WarningRegion | undefined {
  if (timeZone === "Europe/London" || timeZone === "Europe/Belfast") return "UK";
  if (usTimeZones.has(timeZone)) return "US";
  for (const language of languages) {
    try {
      const country = new Intl.Locale(language).region;
      if (country) return regionFromCountryCode(country);
    } catch {
      // Ignore a browser locale that Intl cannot parse.
    }
  }
  return undefined;
}
