import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { notionWebhookCaptureLabel } from "../src/lib/integrations/notion-http.ts";

const directory = path.resolve("dist/notion-readiness/webhook-setup");
const [command, candidateFile] = process.argv.slice(2);

if (command === "prepare") {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2_048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  // Refuse to overwrite keys: an earlier capture may still need its private key.
  await writeFile(path.join(directory, "private-key.pem"), privateKey, { mode: 0o600, flag: "wx" });
  await writeFile(path.join(directory, "public-key.pem"), publicKey, { mode: 0o600, flag: "wx" });
  console.log(`Public key saved to ${path.join(directory, "public-key.pem")}. Set a capture expiry no more than 15 minutes ahead immediately before deploying.`);
} else if (command === "decrypt" && candidateFile) {
  const candidate = (await readFile(candidateFile, "utf8")).trim();
  if (candidate.length > 1_024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(candidate)) throw new Error("Expected one encrypted candidate in base64.");
  const token = privateDecrypt({
    key: await readFile(path.join(directory, "private-key.pem")),
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
    oaepLabel: Buffer.from(notionWebhookCaptureLabel),
  }, Buffer.from(candidate, "base64")).toString("utf8");
  if (!/^secret_[A-Za-z0-9_-]{20,120}$/.test(token)) throw new Error("The decrypted candidate is not a verification token.");
  const output = path.join(directory, "verification-token.txt");
  await writeFile(output, token, { mode: 0o600, flag: "wx" });
  console.log(`Candidate saved privately to ${output}. Verify it in Notion before configuring the production token.`);
} else {
  throw new Error("Usage: pnpm tsx scripts/notion-webhook-setup.ts prepare | decrypt <encrypted-candidate-file>");
}
