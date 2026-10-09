import { describe, expect, it } from "vitest";

import { formatRecallDate, pickTopAlert, timeAgo } from "@/lib/incidents/recency";

const day = 86_400_000;
const now = Date.parse("2026-10-09T12:00:00Z");

describe("recall dates", () => {
  it("says how long ago a recall was issued in plain words", () => {
    expect(timeAgo(now - 2 * 60 * 60 * 1000, now)).toBe("Today");
    expect(timeAgo(now - day, now)).toBe("Yesterday");
    expect(timeAgo(now - 6 * day, now)).toBe("6 days ago");
    expect(timeAgo(now - 7 * day, now)).toBe("1 week ago");
    expect(timeAgo(now - 15 * day, now)).toBe("2 weeks ago");
    expect(timeAgo(now - 45 * day, now)).toBe("1 month ago");
    expect(timeAgo(now - 200 * day, now)).toBe("6 months ago");
    expect(timeAgo(now - 370 * day, now)).toBe("1 yr ago");
    expect(timeAgo(now - 612 * day, now)).toBe("1 yr 8 mo ago");
  });

  it("never reports a future date as ahead of now", () => {
    expect(timeAgo(now + day, now)).toBe("Today");
  });

  it("counts London calendar days across midnight and the daylight-saving change", () => {
    expect(timeAgo(Date.parse("2026-10-08T22:50:00Z"), Date.parse("2026-10-08T23:10:00Z"))).toBe("Yesterday");
    expect(timeAgo(Date.parse("2026-10-24T22:50:00Z"), Date.parse("2026-10-25T01:10:00Z"))).toBe("Yesterday");
  });

  it("formats dates on the London calendar with stable month names", () => {
    expect(formatRecallDate(Date.parse("2026-09-30T12:00:00Z"))).toBe("30 Sep 2026");
    expect(formatRecallDate(new Date("2026-09-30T23:30:00Z"))).toBe("1 Oct 2026");
  });
});

describe("top alert", () => {
  const row = (id: string, ageDays: number, kind: "pathogen" | "allergen") => ({ id, updatedAt: now - ageDays * day, hazard: { kind } });

  it("prefers the newest food-poisoning recall from the last month", () => {
    expect(pickTopAlert([row("milk", 1, "allergen"), row("listeria", 3, "pathogen"), row("salmonella", 5, "pathogen")], now)?.id).toBe("listeria");
  });

  it("falls back to the newest recall when no recent one is food poisoning", () => {
    expect(pickTopAlert([row("milk", 1, "allergen"), row("old-listeria", 90, "pathogen")], now)?.id).toBe("milk");
    expect(pickTopAlert([], now)).toBeUndefined();
  });
});
