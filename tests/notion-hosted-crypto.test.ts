import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptCredentials, encryptCredentials } from "../integrations/notion/hosted/crypto.ts";

const key = randomBytes(32).toString("base64");
const scope = { workspaceId: "workspace-1", ownerId: "owner-1" };
const credentials = { accessToken: "access-token-secret", refreshToken: "refresh-token-secret" };

describe("hosted Notion credential encryption", () => {
  it("round trips credentials in a versioned authenticated envelope", () => {
    const envelope = encryptCredentials(credentials, scope, key);

    expect(envelope.split(".")).toHaveLength(4);
    expect(envelope.startsWith("v1.")).toBe(true);
    expect(envelope).not.toContain(credentials.accessToken);
    expect(envelope).not.toContain(credentials.refreshToken);
    expect(decryptCredentials(envelope, scope, key)).toEqual(credentials);
  });

  it("uses a fresh nonce for every encryption", () => {
    const first = encryptCredentials(credentials, scope, key);
    const second = encryptCredentials(credentials, scope, key);

    expect(first).not.toBe(second);
    expect(decryptCredentials(first, scope, key)).toEqual(credentials);
    expect(decryptCredentials(second, scope, key)).toEqual(credentials);
  });

  it("binds each envelope to the workspace and authorizing owner", () => {
    const envelope = encryptCredentials(credentials, scope, key);

    expect(() => decryptCredentials(envelope, { ...scope, workspaceId: "another-workspace" }, key)).toThrow(/authenticated/);
    expect(() => decryptCredentials(envelope, { ...scope, ownerId: "another-owner" }, key)).toThrow(/authenticated/);
  });

  it("rejects tampering, unknown versions, malformed envelopes, and wrong keys", () => {
    const envelope = encryptCredentials(credentials, scope, key);
    const [version, iv, ciphertext, tag] = envelope.split(".");
    const middle = Math.floor(ciphertext!.length / 2);
    const changedCiphertext = `${ciphertext!.slice(0, middle)}${ciphertext![middle] === "A" ? "B" : "A"}${ciphertext!.slice(middle + 1)}`;

    expect(() => decryptCredentials(`v2.${iv}.${ciphertext}.${tag}`, scope, key)).toThrow(/invalid/);
    expect(() => decryptCredentials(`${version}.${iv}.${changedCiphertext}.${tag}`, scope, key)).toThrow(/authenticated/);
    expect(() => decryptCredentials(envelope, scope, randomBytes(32).toString("base64"))).toThrow(/authenticated/);
    expect(() => decryptCredentials("not-an-envelope", scope, key)).toThrow(/invalid/);
  });

  it("rejects invalid keys, scopes, and credential payloads", () => {
    expect(() => encryptCredentials(credentials, scope, "short-key")).toThrow(/32 bytes/);
    expect(() => encryptCredentials(credentials, { workspaceId: "", ownerId: "owner-1" }, key)).toThrow(/scope/);
    expect(() => encryptCredentials({ ...credentials, extra: "ignored?" } as typeof credentials, scope, key)).toThrow(/credentials/);
    expect(() => encryptCredentials({ accessToken: "", refreshToken: "refresh" }, scope, key)).toThrow(/credentials/);
  });
});
