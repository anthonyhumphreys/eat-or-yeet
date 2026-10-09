import type { HazardKind } from "./hazard";

const DAY = 86_400_000;
const TOP_ALERT_WINDOW_DAYS = 30;

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/London" });
// Fixed month names avoid different abbreviations in server and browser ICU versions.
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3 Oct 2026", on the London calendar, the same on the server and in every browser. */
export function formatRecallDate(value: number | Date): string {
  const parts = dayFormat.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  // en-GB pads the day once a year is included ("01/10/2026"), so read it as a number.
  return `${Number(part("day"))} ${monthNames[Number(part("month")) - 1]} ${part("year")}`;
}

/** How long ago a recall was last updated, so old recalls read as old at a glance: "6 days ago", "1 yr 8 mo ago". */
export function timeAgo(then: number, now = Date.now()): string {
  const days = Math.max(0, Math.floor((now - then) / DAY));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 31) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }
  const months = Math.max(1, Math.floor(days / 30.44));
  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return `${years} yr${rest ? ` ${rest} mo` : ""} ago`;
}

/**
 * The recall to lead the page with: the newest food-poisoning recall from the last month,
 * otherwise simply the newest recall. Rows must already be sorted newest first.
 */
export function pickTopAlert<T extends { updatedAt: number; hazard: { kind: HazardKind } }>(rows: readonly T[], now = Date.now()): T | undefined {
  return rows.find((row) => row.hazard.kind === "pathogen" && now - row.updatedAt <= TOP_ALERT_WINDOW_DAYS * DAY) ?? rows[0];
}
