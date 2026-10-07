import { isValidGtin } from "@/lib/domain/gtin";

const punctuation = /[^a-z0-9]+/g;

export { isValidGtin } from "@/lib/domain/gtin";

export function normaliseText(value: string | null | undefined): string {
  return value?.normalize("NFKD").toLowerCase().replace(punctuation, "").trim() ?? "";
}

export function normaliseCode(value: string | null | undefined): string {
  return value?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
}

export function normaliseGtin(value: string | null | undefined): string {
  const digits = value?.replace(/[\s-]/g, "") ?? "";
  if (!isValidGtin(digits)) return "";
  return digits.padStart(14, "0");
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}
