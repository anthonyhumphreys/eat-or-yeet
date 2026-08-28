export function requireServerSecret(secret: string) {
  const expected = process.env.CONVEX_SERVER_SECRET;
  if (!expected || secret !== expected) throw new Error("Unauthorized");
}
