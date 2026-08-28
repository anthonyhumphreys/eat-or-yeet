const punctuation = /[^a-z0-9]+/g;

export function normaliseText(value: string | null | undefined): string {
  return value?.normalize("NFKD").toLowerCase().replace(punctuation, "").trim() ?? "";
}

export function normaliseCode(value: string | null | undefined): string {
  return value?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
}

export function normaliseGtin(value: string | null | undefined): string {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (![8, 12, 13, 14].includes(digits.length)) return digits;
  return digits.padStart(14, "0");
}

export function isValidGtin(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return false;
  const body = digits.slice(0, -1);
  const expected = Number(digits.at(-1));
  const sum = [...body]
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === expected;
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}
