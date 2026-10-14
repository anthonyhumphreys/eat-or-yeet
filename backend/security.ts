import { timingSafeEqual } from "node:crypto";

export function equalSecrets(secret: string, expected: string | undefined) {
  if (!expected || !secret) return false;
  const left = Buffer.from(secret), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requireServerSecret(secret: string) {
  const expected = process.env.BACKEND_SECRET;
  if (
    typeof expected !== "string" ||
    expected.length === 0 ||
    typeof secret !== "string" ||
    secret.length === 0 ||
    !equalSecrets(secret, expected)
  ) {
    throw new Error("Unauthorized");
  }
}
