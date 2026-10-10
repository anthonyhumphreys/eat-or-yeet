import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ManagedStore } from "../integrations/notion/managed/store";
import type { Authorization, ListBinding } from "../integrations/notion/managed/types";

const key = Buffer.alloc(32, 19);
const stores: ManagedStore[] = [];
function store(path = ":memory:", limit = 5, encryptionKey = key): ManagedStore {
  const value = new ManagedStore(path, encryptionKey, limit);
  stores.push(value);
  return value;
}
function auth(ownerId = "owner-1", workspaceId = "workspace-1", accessToken = "access-secret"): Authorization {
  return { ownerId, workspaceId, botId: `bot-${ownerId}`, accessToken, refreshToken: "refresh-secret" };
}
function binding(databaseId = "database-1", dataSourceId = "source-1"): ListBinding {
  return { templatePageId: "template-1", databaseId, dataSourceId, properties: {} as ListBinding["properties"], statusLabels: { found: "Found", none: "None", unable: "Unable" } };
}
function authorize(value: ManagedStore, user = auth(), now = 1_000): string { return value.authorize(user, "UK", now).id; }

afterEach(() => { while (stores.length) stores.pop()?.close(); });

describe("ManagedStore", () => {
  it("expires OAuth states and consumes each matching state once", () => {
    const value = store();
    value.createOAuth("state", "binding", { region: "UK", expiresAt: 10 }, 1);
    expect(value.consumeOAuth("state", "binding", 10)).toBeUndefined();
    value.createOAuth("state-2", "binding-2", { region: "US", installationId: "install", expiresAt: 20 }, 1);
    expect(value.consumeOAuth("state-2", "wrong", 2)).toBeUndefined();
    expect(value.consumeOAuth("state-2", "binding-2", 2)).toEqual({ region: "US", installationId: "install", expiresAt: 20 });
    expect(value.consumeOAuth("state-2", "binding-2", 2)).toBeUndefined();
  });

  it("encrypts tokens at rest, authenticates ciphertext, and keeps credentials out of installation results", async () => {
    const directory = await mkdtemp(join(tmpdir(), "managed-store-"));
    const path = join(directory, "managed.sqlite");
    try {
      const value = store(path);
      const id = authorize(value);
      expect(value.getCredentials(id)).toEqual({ accessToken: "access-secret", refreshToken: "refresh-secret" });
      expect(value.get(id)).not.toHaveProperty("accessToken");
      expect(JSON.stringify(value.list())).not.toContain("refresh-secret");
      value.close();
      stores.splice(stores.indexOf(value), 1);
      expect((await readFile(path)).toString("utf8")).not.toContain("access-secret");

      const wrongKey = store(path, 5, Buffer.alloc(32, 20));
      expect(() => wrongKey.getCredentials(id)).toThrow("could not be decrypted");
      wrongKey.close();
      stores.splice(stores.indexOf(wrongKey), 1);

      const database = new DatabaseSync(path);
      database.prepare("UPDATE installations SET id='tampered-id' WHERE id=?").run(id);
      database.close();
      const tampered = store(path);
      expect(() => tampered.getCredentials("tampered-id")).toThrow("could not be decrypted");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("sets private database permissions and rejects an invalid encryption key", async () => {
    expect(() => new ManagedStore(":memory:", Buffer.alloc(16), 1)).toThrow("32 bytes");
    const directory = await mkdtemp(join(tmpdir(), "managed-mode-"));
    try {
      const path = join(directory, "store.sqlite");
      const value = store(path);
      value.close(); stores.splice(stores.indexOf(value), 1);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("protects owner identity, caps new installations, and permits same-owner authorization refresh", () => {
    const value = store(":memory:", 1);
    const id = authorize(value);
    expect(() => value.authorize(auth("someone-else"), "US", 2, id)).toThrow("ownership check failed");
    expect(value.get(id)).toMatchObject({ generation: 1, region: "UK", status: "setting_up" });
    expect(value.authorize(auth("owner-1", "workspace-1", "new-access"), "US", 3, id)).toMatchObject({ id, generation: 2, region: "US" });
    expect(value.getCredentials(id)?.accessToken).toBe("new-access");
    expect(() => authorize(value, auth("owner-2"), 4)).toThrow("capacity is full");
  });

  it("keeps the bound template page when reauthorization omits a replacement page", () => {
    const value = store();
    const id = value.authorize({ ...auth(), templatePageId: "oauth-template" }, "UK", 1).id;
    value.bind(id, 1, { ...binding(), templatePageId: "created-template" }, 2);
    const refreshed = value.authorize({ ...auth("owner-1", "workspace-1", "new-access"), templatePageId: "new-duplicate" }, "UK", 3, id);
    expect(refreshed.templatePageId).toBe("created-template");
    expect(refreshed.binding?.templatePageId).toBe("created-template");
  });

  it("fences lifecycle generations and enforces unique active or paused list bindings", () => {
    const value = store();
    const first = authorize(value);
    const second = authorize(value, auth("owner-2", "workspace-2"));
    const bound = value.bind(first, 1, binding(), 2);
    expect(bound.binding).toEqual(binding());
    expect(() => value.bind(first, 0, binding("other-db", "other-source"), 3)).toThrow("generation check failed");
    expect(() => value.bind(second, 1, binding(), 3)).toThrow("already bound");
    value.update(first, "setup_failed", 4);
    expect(() => value.bind(second, 1, binding("db-2", "source-1"), 5)).toThrow("already bound");
    value.update(first, "active", 6);
    value.update(second, "active", 6);
    expect(() => value.bind(second, 2, binding(), 7)).toThrow("already bound");
    value.update(first, "paused", 8);
    expect(() => value.bind(second, 2, binding("db-2", "source-1"), 9)).toThrow("already bound");
    expect(value.update(second, "needs_reconnect", 10, { region: "US", errorCode: "access_revoked" })).toMatchObject({ generation: 3, region: "US", errorCode: "access_revoked" });
  });

  it("rechecks cross-installation binding reservations transactionally when marking setup ready", async () => {
    const directory = await mkdtemp(join(tmpdir(), "managed-ready-reservation-"));
    const path = join(directory, "managed.sqlite");
    try {
      const value = store(path);
      const first = authorize(value);
      const second = authorize(value, auth("owner-2", "workspace-2"));
      value.bind(first, 1, binding(), 2);
      expect(() => value.bind(second, 1, binding("database-2", "source-1"), 3)).toThrow("already bound");
      value.close(); stores.splice(stores.indexOf(value), 1);

      // Simulate a duplicate left by an older store version. The ready-time
      // transaction must still prevent both pending installations becoming writers.
      const database = new DatabaseSync(path);
      database.prepare("UPDATE installations SET binding_json=? WHERE id=?").run(JSON.stringify(binding("database-2", "source-1")), second);
      database.close();
      const reopened = store(path);
      expect(() => reopened.ready(first, 1, 4)).toThrow("already reserved");
      expect(reopened.get(first)?.status).toBe("setting_up");
      expect(reopened.get(second)?.status).toBe("setting_up");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("keeps a binding reserved while disconnecting and releases it after removal", () => {
    const value = store();
    const first = authorize(value);
    const second = authorize(value, auth("owner-2", "workspace-2"));
    value.bind(first, 1, binding(), 2);
    value.update(first, "disconnecting", 3);
    expect(() => value.bind(second, 1, binding(), 4)).toThrow("already bound");
    value.remove(first);
    expect(value.bind(second, 1, binding(), 5).binding).toEqual(binding());
  });

  it("marks setup ready only for the matching generation without advancing it", () => {
    const value = store();
    const id = authorize(value);
    expect(value.ready(id, 1, 2)).toMatchObject({ status: "active", generation: 1, updatedAt: 2 });
    expect(() => value.ready(id, 1, 3)).toThrow("setup generation check failed");
    const another = authorize(value, auth("owner-2"), 4);
    expect(() => value.ready(another, 2, 5)).toThrow("setup generation check failed");
  });

  it("stores only session hashes, expires sessions, and deletes sessions and local counters on removal", () => {
    const value = store();
    const id = authorize(value);
    value.createSession("raw-cookie", id, "csrf", 10);
    expect(value.session("wrong-cookie", 2)).toBeUndefined();
    expect(value.session("raw-cookie", 9)).toEqual({ installationId: id, csrfToken: "csrf", expiresAt: 10 });
    expect(value.session("raw-cookie", 10)).toBeUndefined();
    value.createSession("another-cookie", id, "csrf-2", 20);
    value.remove(id);
    expect(value.session("another-cookie", 11)).toBeUndefined();
    expect(value.get(id)).toBeUndefined();
  });

  it("bounds sessions per installation by retaining the ten latest expiries", () => {
    const value = store();
    const id = authorize(value);
    for (let index = 0; index < 11; index += 1) value.createSession(`cookie-${index}`, id, `csrf-${index}`, 100 + index);
    expect(value.session("cookie-0", 1)).toBeUndefined();
    expect(value.session("cookie-1", 1)).toMatchObject({ installationId: id, expiresAt: 101 });
    expect(value.session("cookie-10", 1)).toMatchObject({ installationId: id, expiresAt: 110 });
  });

  it("uses compare-and-swap credential replacement and daily per-installation and global budgets", () => {
    const value = store();
    const id = authorize(value);
    expect(value.replaceCredentials(id, "wrong", { accessToken: "next", refreshToken: "next-refresh" })).toBe(false);
    expect(value.replaceCredentials(id, "access-secret", { accessToken: "next", refreshToken: "next-refresh" })).toBe(true);
    expect(value.get(id)?.generation).toBe(1);
    expect(value.replaceCredentials(id, "access-secret", { accessToken: "stale", refreshToken: "stale" })).toBe(false);
    value.update(id, "active", 2);
    expect(value.budget(id, 5, 2, 1)).toEqual({ allowed: true, retryAt: 86_400_000, used: 0, globalUsed: 0 });
    expect(value.takeReview(id, 5, 2, 1)).toMatchObject({ allowed: true });
    expect(value.budget(id, 5, 2, 1)).toEqual({ allowed: false, retryAt: 86_400_000, used: 1, globalUsed: 1 });
    expect(value.takeReview(id, 6, 2, 1)).toMatchObject({ allowed: false, retryAt: 86_400_000 });
    const second = authorize(value, auth("owner-2", "workspace-2"), 7);
    value.update(second, "active", 8);
    expect(value.takeReview(second, 9, 2, 1)).toMatchObject({ allowed: false, retryAt: 86_400_000 });
    expect(value.takeReview(second, 86_400_000, 1, 1)).toMatchObject({ allowed: true, retryAt: 172_800_000 });
    value.update(second, "disconnecting", 10);
    expect(value.replaceCredentials(second, "access-secret", { accessToken: "bad", refreshToken: "bad" })).toBe(false);
  });

  it("cleans expired OAuth, sessions, and daily counters", () => {
    const value = store();
    const id = authorize(value);
    value.createOAuth("state", "binding", { region: "UK", expiresAt: 4 }, 1);
    value.createSession("raw", id, "csrf", 4);
    value.update(id, "active", 1);
    value.takeReview(id, 1, 10, 10);
    value.cleanup(86_400_000);
    expect(value.consumeOAuth("state", "binding", 5)).toBeUndefined();
    expect(value.session("raw", 5)).toBeUndefined();
    expect(value.takeReview(id, 86_400_000, 1, 1)).toMatchObject({ allowed: true });
  });
});
