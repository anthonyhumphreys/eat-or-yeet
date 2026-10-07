export type DateBounds = {
  dateFrom: Date;
  dateTo: Date;
};

type DateCandidate = {
  start: number;
  end: number;
  bounds: DateBounds;
};

const monthNumbers: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function utcDate(year: number, month: number, day: number): Date | null {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day
    ? value
    : null;
}

function yearValue(value: string): number | null {
  if (value.length === 4) return Number(value);
  if (value.length === 2) {
    const year = Number(value);
    return year >= 50 ? 1900 + year : 2000 + year;
  }
  return null;
}

function exactBounds(date: Date): DateBounds {
  const copy = new Date(date);
  return { dateFrom: copy, dateTo: new Date(copy) };
}

function monthBounds(year: number, month: number): DateBounds | null {
  const dateFrom = utcDate(year, month, 1);
  if (!dateFrom) return null;
  const dateTo = new Date(Date.UTC(year, month, 0));
  return { dateFrom, dateTo };
}

function makeCandidate(input: string, start: number, end: number, date: Date): DateCandidate {
  return { start, end, bounds: exactBounds(date) };
}

function candidatesFor(input: string, dayFirst: boolean): DateCandidate[] {
  const candidates: DateCandidate[] = [];
  const pattern = /\b(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})|(\d{1,2})\s+([a-z]+)\s+(\d{4})|([a-z]+)\s+(\d{1,2}),?\s+(\d{4})|([a-z]+)\s+(\d{4})|(\d{1,2})[/-](\d{4}))\b/gi;

  for (const match of input.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    let date: Date | null = null;

    if (match[1]) {
      date = utcDate(Number(match[1]), Number(match[2]), Number(match[3]));
    } else if (match[4]) {
      const first = Number(match[4]);
      const second = Number(match[5]);
      const year = yearValue(match[6]);
      if (year) date = utcDate(year, dayFirst ? second : first, dayFirst ? first : second);
    } else if (match[7]) {
      date = utcDate(Number(match[9]), monthNumbers[match[8].toLowerCase()] ?? 0, Number(match[7]));
    } else if (match[10]) {
      date = utcDate(Number(match[12]), monthNumbers[match[10].toLowerCase()] ?? 0, Number(match[11]));
    }

    if (date) {
      candidates.push(makeCandidate(input, start, end, date));
      continue;
    }

    if (match[13]) {
      const bounds = monthBounds(Number(match[14]), monthNumbers[match[13].toLowerCase()] ?? 0);
      if (bounds) candidates.push({ start, end, bounds });
    } else if (match[15]) {
      const bounds = monthBounds(Number(match[16]), Number(match[15]));
      if (bounds) candidates.push({ start, end, bounds });
    }
  }

  return candidates;
}

/**
 * Parse a single explicit date or a clearly stated date range. Ambiguous prose
 * stays unparsed so the caller can preserve it as a restriction in target notes.
 */
export function parseDateBounds(input: string, dayFirst = false): DateBounds | null {
  const candidates = candidatesFor(input, dayFirst);
  if (candidates.length === 1) return candidates[0].bounds;
  if (candidates.length !== 2) return null;

  const [first, second] = candidates;
  const beforeFirst = input.slice(0, first.start);
  const between = input.slice(first.end, second.start);
  if (!/\b(?:from|between|dates?\s+from)\b/i.test(beforeFirst) || !/\b(?:through|to|until|and)\b/i.test(between)) {
    return null;
  }

  const dateFrom = first.bounds.dateFrom <= second.bounds.dateFrom ? first.bounds.dateFrom : second.bounds.dateFrom;
  const dateTo = first.bounds.dateTo >= second.bounds.dateTo ? first.bounds.dateTo : second.bounds.dateTo;
  return { dateFrom: new Date(dateFrom), dateTo: new Date(dateTo) };
}
