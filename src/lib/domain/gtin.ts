const allowedBarcodeCharacters = /^[\d\s-]+$/;
const supportedLengths = new Set([8, 12, 13, 14]);

export function isValidGtin(value: string): boolean {
  if (!allowedBarcodeCharacters.test(value)) return false;

  const digits = value.replace(/[\s-]/g, "");
  if (!supportedLengths.has(digits.length)) return false;

  const body = digits.slice(0, -1);
  const expected = Number(digits.at(-1));
  const sum = [...body]
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);

  return (10 - (sum % 10)) % 10 === expected;
}
