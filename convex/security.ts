export function requireServerSecret(secret: string) {
  const expected = process.env.CONVEX_SERVER_SECRET;
  if (
    typeof expected !== "string" ||
    expected.length === 0 ||
    typeof secret !== "string" ||
    secret.length === 0 ||
    secret !== expected
  ) {
    throw new Error("Unauthorized");
  }
}
