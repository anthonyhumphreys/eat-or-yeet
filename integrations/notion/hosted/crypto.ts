import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const CIPHER = "aes-256-gcm";
const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_TOKEN_LENGTH = 4_096;
const MAX_SCOPE_LENGTH = 1_024;

export type CredentialScope = { workspaceId: string; ownerId: string };
export type NotionCredentials = { accessToken: string; refreshToken: string };

export function encryptCredentials(credentials: NotionCredentials, scope: CredentialScope, keyString: string): string {
  validateCredentials(credentials);
  const key = decodeKey(keyString);
  const aad = associatedData(scope);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".");
}

export function decryptCredentials(envelope: string, scope: CredentialScope, keyString: string): NotionCredentials {
  const key = decodeKey(keyString);
  const aad = associatedData(scope);
  if (typeof envelope !== "string" || envelope.length > 16_384) throw new Error("Notion credential envelope is invalid.");
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) throw new Error("Notion credential envelope is invalid.");
  const iv = decodeSegment(parts[1], IV_BYTES, "initialization vector");
  const ciphertext = decodeSegment(parts[2], undefined, "ciphertext");
  const tag = decodeSegment(parts[3], TAG_BYTES, "authentication tag");
  try {
    const decipher = createDecipheriv(CIPHER, key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const value: unknown = JSON.parse(plaintext);
    validateCredentials(value);
    return { accessToken: value.accessToken, refreshToken: value.refreshToken };
  } catch {
    throw new Error("Notion credential envelope could not be authenticated.");
  }
}

function decodeKey(value: string): Buffer {
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9_+/-]+={0,2}$/.test(value)) {
    throw new Error("Notion credential encryption key is invalid.");
  }
  const key = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (key.length !== 32) throw new Error("Notion credential encryption key must encode 32 bytes.");
  return key;
}

function associatedData(scope: CredentialScope): Buffer {
  validateScope(scope);
  return Buffer.from(JSON.stringify([
    "eat-or-yeet",
    "notion-credentials",
    ENVELOPE_VERSION,
    scope.workspaceId,
    scope.ownerId,
  ]), "utf8");
}

function validateScope(scope: CredentialScope): void {
  if (!scope || typeof scope.workspaceId !== "string" || !scope.workspaceId.trim() || scope.workspaceId.length > MAX_SCOPE_LENGTH
    || typeof scope.ownerId !== "string" || !scope.ownerId.trim() || scope.ownerId.length > MAX_SCOPE_LENGTH) {
    throw new Error("Notion credential scope is invalid.");
  }
}

function validateCredentials(value: unknown): asserts value is NotionCredentials {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Notion credentials are invalid.");
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.accessToken !== "string" || !candidate.accessToken.trim() || candidate.accessToken.length > MAX_TOKEN_LENGTH
    || typeof candidate.refreshToken !== "string" || !candidate.refreshToken.trim() || candidate.refreshToken.length > MAX_TOKEN_LENGTH
    || Object.keys(candidate).some((key) => key !== "accessToken" && key !== "refreshToken")) {
    throw new Error("Notion credentials are invalid.");
  }
}

function decodeSegment(value: string, exactLength: number | undefined, label: string): Buffer {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Notion credential envelope ${label} is invalid.`);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value || (exactLength !== undefined && decoded.length !== exactLength)) {
    throw new Error(`Notion credential envelope ${label} is invalid.`);
  }
  return decoded;
}
