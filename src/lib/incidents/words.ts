/** Lower-case words with accents, apostrophes and hyphens folded, and "&" read as "and". */
export function words(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’'‘`-]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function startsWithWords(haystack: string[], needle: string[]): boolean {
  return needle.length > 0 && needle.length <= haystack.length && needle.every((word, index) => haystack[index] === word);
}

export function containsWords(haystack: string[], needle: string[]): boolean {
  for (let index = 0; index + needle.length <= haystack.length; index += 1) {
    if (startsWithWords(haystack.slice(index), needle)) return true;
  }
  return false;
}
