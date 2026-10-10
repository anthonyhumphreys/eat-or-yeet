import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Authorization, Credentials, Installation, InstallationStatus, ListBinding, ManagementSession, OAuthPending, Region } from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_OAUTH_ROWS = 1_000;
const MAX_SESSIONS_PER_INSTALLATION = 10;

type InstallationRow = {
  id: string; owner_id: string; workspace_id: string; bot_id: string; template_page_id: string | null;
  region: string; status: string; generation: number; binding_json: string | null; created_at: number;
  updated_at: number; error_code: string | null;
};
type EncryptedCredentials = { iv: string; tag: string; data: string };

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function validRegion(value: string): value is Region { return value === "UK" || value === "US"; }
function validStatus(value: string): value is InstallationStatus {
  return ["setting_up", "active", "paused", "needs_reconnect", "setup_failed", "disconnecting"].includes(value);
}
function safeError(): Error { return new Error("Managed installation store operation failed."); }

export class ManagedStore {
  readonly #db: DatabaseSync;
  readonly #key: Buffer;
  readonly #maxInstallations: number;

  constructor(path: string, encryptionKey: Buffer, maxInstallations: number) {
    if (encryptionKey.length !== 32) throw new Error("Managed store encryption key must be 32 bytes.");
    if (!Number.isSafeInteger(maxInstallations) || maxInstallations < 1) throw new Error("Managed store installation limit must be a positive integer.");
    this.#key = Buffer.from(encryptionKey);
    this.#maxInstallations = maxInstallations;
    this.#db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.#db.exec(`PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS installations (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL, bot_id TEXT NOT NULL,
        template_page_id TEXT, region TEXT NOT NULL, status TEXT NOT NULL, generation INTEGER NOT NULL,
        binding_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error_code TEXT,
        credentials_iv TEXT NOT NULL, credentials_tag TEXT NOT NULL, credentials_data TEXT NOT NULL,
        UNIQUE(workspace_id, owner_id));
      CREATE TABLE IF NOT EXISTS oauth_pending (state_hash TEXT PRIMARY KEY, binding_hash TEXT NOT NULL, pending_json TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS management_sessions (raw_hash TEXT PRIMARY KEY, installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE, csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS review_counters (installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE, day INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(installation_id, day));
      CREATE TABLE IF NOT EXISTS global_review_counters (day INTEGER PRIMARY KEY, used INTEGER NOT NULL);`);
  }

  createOAuth(state: string, binding: string, pending: OAuthPending, now: number): void {
    if (!state || !binding || pending.expiresAt <= now || !validRegion(pending.region)) throw new Error("Invalid OAuth request.");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("DELETE FROM oauth_pending WHERE expires_at <= ?").run(now);
      const count = this.#db.prepare("SELECT COUNT(*) AS count FROM oauth_pending").get() as { count: number };
      if (count.count >= MAX_OAUTH_ROWS) {
        this.#db.prepare("DELETE FROM oauth_pending WHERE state_hash = (SELECT state_hash FROM oauth_pending ORDER BY expires_at LIMIT 1)").run();
      }
      this.#db.prepare("INSERT INTO oauth_pending(state_hash,binding_hash,pending_json,expires_at) VALUES(?,?,?,?)")
        .run(hash(state), hash(binding), JSON.stringify(pending), pending.expiresAt);
      this.#db.exec("COMMIT");
    } catch (error) { this.#rollback(); throw error; }
  }

  consumeOAuth(state: string, binding: string, now: number): OAuthPending | undefined {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#db.prepare("SELECT binding_hash,pending_json,expires_at FROM oauth_pending WHERE state_hash=?").get(hash(state)) as { binding_hash: string; pending_json: string; expires_at: number } | undefined;
      if (!row) { this.#db.prepare("DELETE FROM oauth_pending WHERE expires_at <= ?").run(now); this.#db.exec("COMMIT"); return undefined; }
      if (row.expires_at <= now || row.binding_hash !== hash(binding)) {
        if (row.expires_at <= now) this.#db.prepare("DELETE FROM oauth_pending WHERE state_hash=?").run(hash(state));
        this.#db.prepare("DELETE FROM oauth_pending WHERE expires_at <= ?").run(now);
        this.#db.exec("COMMIT");
        return undefined;
      }
      this.#db.prepare("DELETE FROM oauth_pending WHERE state_hash=?").run(hash(state));
      this.#db.prepare("DELETE FROM oauth_pending WHERE expires_at <= ?").run(now);
      this.#db.exec("COMMIT");
      return JSON.parse(row.pending_json) as OAuthPending;
    } catch (error) { this.#rollback(); throw error; }
  }

  findOwner(workspaceId: string, ownerId: string): Installation | undefined {
    return this.#installation(this.#db.prepare("SELECT * FROM installations WHERE workspace_id=? AND owner_id=?").get(workspaceId, ownerId) as InstallationRow | undefined);
  }
  get(id: string): Installation | undefined { return this.#installation(this.#db.prepare("SELECT * FROM installations WHERE id=?").get(id) as InstallationRow | undefined); }
  list(): Installation[] { return (this.#db.prepare("SELECT * FROM installations ORDER BY created_at,id").all() as InstallationRow[]).map((row) => this.#installation(row)!); }

  authorize(auth: Authorization, region: Region, now: number, expectedInstallationId?: string): Installation {
    if (!validRegion(region) || !auth.ownerId || !auth.workspaceId || !auth.botId || !auth.accessToken || !auth.refreshToken) throw new Error("Invalid authorization data.");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#db.prepare("SELECT * FROM installations WHERE workspace_id=? AND owner_id=?").get(auth.workspaceId, auth.ownerId) as InstallationRow | undefined;
      if (expectedInstallationId !== undefined && (!existing || existing.id !== expectedInstallationId)) throw new Error("Installation ownership check failed.");
      let id: string;
      if (existing) {
        id = existing.id;
        const credentials = this.#encrypt(id, { accessToken: auth.accessToken, refreshToken: auth.refreshToken });
        this.#db.prepare(`UPDATE installations SET bot_id=?,template_page_id=COALESCE(json_extract(binding_json,'$.templatePageId'),?,template_page_id),region=?,status='setting_up',generation=generation+1,
          updated_at=?,error_code=NULL,credentials_iv=?,credentials_tag=?,credentials_data=? WHERE id=?`)
          .run(auth.botId, auth.templatePageId ?? null, region, now, credentials.iv, credentials.tag, credentials.data, id);
      } else {
        const count = this.#db.prepare("SELECT COUNT(*) AS count FROM installations").get() as { count: number };
        if (count.count >= this.#maxInstallations) throw new Error("Managed installation capacity is full.");
        id = randomUUID();
        const encrypted = this.#encrypt(id, { accessToken: auth.accessToken, refreshToken: auth.refreshToken });
        this.#db.prepare(`INSERT INTO installations(id,owner_id,workspace_id,bot_id,template_page_id,region,status,generation,binding_json,created_at,updated_at,error_code,credentials_iv,credentials_tag,credentials_data)
          VALUES(?,?,?,?,?,?,'setting_up',1,NULL,?,?,NULL,?,?,?)`)
          .run(id, auth.ownerId, auth.workspaceId, auth.botId, auth.templatePageId ?? null, region, now, now, encrypted.iv, encrypted.tag, encrypted.data);
      }
      this.#db.exec("COMMIT");
      const result = this.get(id);
      if (!result) throw safeError();
      return result;
    } catch (error) { this.#rollback(); throw error; }
  }

  getCredentials(id: string): Credentials | undefined {
    const row = this.#db.prepare("SELECT credentials_iv AS iv,credentials_tag AS tag,credentials_data AS data FROM installations WHERE id=?").get(id) as EncryptedCredentials | undefined;
    if (!row) return undefined;
    return this.#decrypt(id, row);
  }

  replaceCredentials(id: string, expectedAccessToken: string, next: Credentials): boolean {
    const row = this.#db.prepare("SELECT status,credentials_iv AS iv,credentials_tag AS tag,credentials_data AS data FROM installations WHERE id=?").get(id) as ({ status: string } & EncryptedCredentials) | undefined;
    if (!row || row.status === "disconnecting") return false;
    const current = this.getCredentials(id);
    if (!current || current.accessToken !== expectedAccessToken) return false;
    const encrypted = this.#encrypt(id, next);
    const result = this.#db.prepare(`UPDATE installations SET credentials_iv=?,credentials_tag=?,credentials_data=?
      WHERE id=? AND status!='disconnecting' AND credentials_iv=? AND credentials_tag=? AND credentials_data=?`)
      .run(encrypted.iv, encrypted.tag, encrypted.data, id, row.iv, row.tag, row.data);
    return result.changes > 0;
  }

  bind(id: string, expectedGeneration: number, binding: ListBinding, now: number): Installation {
    if (!binding?.databaseId || !binding.dataSourceId || !binding.templatePageId) throw new Error("Invalid Notion list binding.");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.#db.prepare("SELECT generation FROM installations WHERE id=?").get(id) as { generation: number } | undefined;
      if (!current || current.generation !== expectedGeneration) throw new Error("Installation generation check failed.");
      const conflict = this.#db.prepare(`SELECT 1 FROM installations WHERE id<>? AND binding_json IS NOT NULL AND
        (json_extract(binding_json,'$.databaseId')=? OR json_extract(binding_json,'$.dataSourceId')=?)`).get(id, binding.databaseId, binding.dataSourceId);
      if (conflict) throw new Error("Notion list is already bound to another installation.");
      const result = this.#db.prepare("UPDATE installations SET binding_json=?,template_page_id=?,updated_at=? WHERE id=? AND generation=?")
        .run(JSON.stringify(binding), binding.templatePageId, now, id, expectedGeneration);
      if (!result.changes) throw new Error("Installation generation check failed.");
      this.#db.exec("COMMIT");
      const installation = this.get(id);
      if (!installation) throw safeError();
      return installation;
    } catch (error) { this.#rollback(); throw error; }
  }

  update(id: string, status: InstallationStatus, now: number, options?: { region?: Region; errorCode?: Installation["errorCode"] }): Installation {
    if (!validStatus(status) || (options?.region !== undefined && !validRegion(options.region))) throw new Error("Invalid installation update.");
    const result = this.#db.prepare(`UPDATE installations SET status=?,region=COALESCE(?,region),error_code=?,generation=generation+1,updated_at=? WHERE id=?`)
      .run(status, options?.region ?? null, options?.errorCode ?? null, now, id);
    if (!result.changes) throw new Error("Installation not found.");
    const installation = this.get(id);
    if (!installation) throw safeError();
    return installation;
  }

  ready(id: string, expectedGeneration: number, now: number): Installation {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const conflict = this.#db.prepare(`SELECT 1 FROM installations current JOIN installations other ON current.id=? AND other.id<>current.id
        WHERE current.status='setting_up' AND current.generation=? AND other.binding_json IS NOT NULL AND
        (json_extract(current.binding_json,'$.databaseId')=json_extract(other.binding_json,'$.databaseId') OR
         json_extract(current.binding_json,'$.dataSourceId')=json_extract(other.binding_json,'$.dataSourceId'))`).get(id, expectedGeneration);
      if (conflict) throw new Error("Notion list is already reserved by another installation.");
      const result = this.#db.prepare("UPDATE installations SET status='active',error_code=NULL,updated_at=? WHERE id=? AND generation=? AND status='setting_up'")
        .run(now, id, expectedGeneration);
      if (!result.changes) throw new Error("Installation setup generation check failed.");
      this.#db.exec("COMMIT");
      const installation = this.get(id);
      if (!installation) throw safeError();
      return installation;
    } catch (error) { this.#rollback(); throw error; }
  }

  createSession(raw: string, installationId: string, csrfToken: string, expiresAt: number): void {
    if (!raw || !csrfToken || !Number.isFinite(expiresAt)) throw new Error("Invalid management session.");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("INSERT INTO management_sessions(raw_hash,installation_id,csrf_token,expires_at) VALUES(?,?,?,?)")
        .run(hash(raw), installationId, csrfToken, expiresAt);
      this.#db.prepare(`DELETE FROM management_sessions WHERE installation_id=? AND raw_hash NOT IN
        (SELECT raw_hash FROM management_sessions WHERE installation_id=? ORDER BY expires_at DESC,raw_hash LIMIT ?)`)
        .run(installationId, installationId, MAX_SESSIONS_PER_INSTALLATION);
      this.#db.exec("COMMIT");
    } catch (error) { this.#rollback(); throw error; }
  }
  session(raw: string, now: number): ManagementSession | undefined {
    const rawHash = hash(raw);
    const row = this.#db.prepare("SELECT installation_id,csrf_token,expires_at FROM management_sessions WHERE raw_hash=?").get(rawHash) as { installation_id: string; csrf_token: string; expires_at: number } | undefined;
    if (!row) { this.#db.prepare("DELETE FROM management_sessions WHERE expires_at<=?").run(now); return undefined; }
    if (row.expires_at <= now || !this.get(row.installation_id)) {
      this.#db.prepare("DELETE FROM management_sessions WHERE raw_hash=? OR expires_at<=?").run(rawHash, now);
      return undefined;
    }
    return { installationId: row.installation_id, csrfToken: row.csrf_token, expiresAt: row.expires_at };
  }
  remove(id: string): void {
    this.#db.prepare("DELETE FROM installations WHERE id=?").run(id);
  }

  takeReview(id: string, now: number, perInstallation: number, global: number): { allowed: boolean; retryAt: number } {
    const day = Math.floor(now / DAY_MS);
    const retryAt = (day + 1) * DAY_MS;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const installation = this.#db.prepare("SELECT status FROM installations WHERE id=?").get(id) as { status: string } | undefined;
      if (!installation || installation.status !== "active") { this.#db.exec("COMMIT"); return { allowed: false, retryAt: now }; }
      const local = this.#db.prepare("SELECT used FROM review_counters WHERE installation_id=? AND day=?").get(id, day) as { used: number } | undefined;
      const total = this.#db.prepare("SELECT used FROM global_review_counters WHERE day=?").get(day) as { used: number } | undefined;
      if (!Number.isSafeInteger(perInstallation) || perInstallation < 0 || !Number.isSafeInteger(global) || global < 0 || (local?.used ?? 0) >= perInstallation || (total?.used ?? 0) >= global) {
        this.#db.exec("COMMIT"); return { allowed: false, retryAt };
      }
      this.#db.prepare("INSERT INTO review_counters(installation_id,day,used) VALUES(?,?,1) ON CONFLICT(installation_id,day) DO UPDATE SET used=used+1").run(id, day);
      this.#db.prepare("INSERT INTO global_review_counters(day,used) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET used=used+1").run(day);
      this.#db.exec("COMMIT");
      return { allowed: true, retryAt };
    } catch (error) { this.#rollback(); throw error; }
  }

  budget(id: string, now: number, perInstallation: number, global: number): { allowed: boolean; retryAt: number; used: number; globalUsed: number } {
    const day = Math.floor(now / DAY_MS);
    const retryAt = (day + 1) * DAY_MS;
    const installation = this.#db.prepare("SELECT status FROM installations WHERE id=?").get(id) as { status: string } | undefined;
    const local = this.#db.prepare("SELECT used FROM review_counters WHERE installation_id=? AND day=?").get(id, day) as { used: number } | undefined;
    const total = this.#db.prepare("SELECT used FROM global_review_counters WHERE day=?").get(day) as { used: number } | undefined;
    const used = local?.used ?? 0;
    const globalUsed = total?.used ?? 0;
    const validLimits = Number.isSafeInteger(perInstallation) && perInstallation >= 0 && Number.isSafeInteger(global) && global >= 0;
    return { allowed: installation?.status === "active" && validLimits && used < perInstallation && globalUsed < global, retryAt, used, globalUsed };
  }

  cleanup(now: number): void {
    this.#db.prepare("DELETE FROM oauth_pending WHERE expires_at<=?").run(now);
    this.#db.prepare("DELETE FROM management_sessions WHERE expires_at<=?").run(now);
    const day = Math.floor(now / DAY_MS);
    this.#db.prepare("DELETE FROM review_counters WHERE day<?").run(day);
    this.#db.prepare("DELETE FROM global_review_counters WHERE day<?").run(day);
  }
  close(): void { this.#db.close(); }

  #installation(row: InstallationRow | undefined): Installation | undefined {
    if (!row) return undefined;
    let binding: ListBinding | undefined;
    try { binding = row.binding_json ? JSON.parse(row.binding_json) as ListBinding : undefined; } catch { throw safeError(); }
    if (!validRegion(row.region) || !validStatus(row.status)) throw safeError();
    return {
      id: row.id, ownerId: row.owner_id, workspaceId: row.workspace_id, botId: row.bot_id,
      ...(row.template_page_id ? { templatePageId: row.template_page_id } : {}), region: row.region,
      status: row.status, generation: row.generation, ...(binding ? { binding } : {}),
      createdAt: row.created_at, updatedAt: row.updated_at,
      ...(row.error_code ? { errorCode: row.error_code as Installation["errorCode"] } : {}),
    };
  }
  #encrypt(id: string, credentials: Credentials): EncryptedCredentials {
    const ivBytes = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, ivBytes);
    cipher.setAAD(Buffer.from(id));
    const data = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
    return { iv: ivBytes.toString("hex"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
  }
  #decrypt(id: string, encrypted: EncryptedCredentials): Credentials {
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(encrypted.iv, "hex"));
      decipher.setAAD(Buffer.from(id));
      decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
      const raw = Buffer.concat([decipher.update(Buffer.from(encrypted.data, "base64")), decipher.final()]).toString("utf8");
      const value = JSON.parse(raw) as Partial<Credentials>;
      if (typeof value.accessToken !== "string" || typeof value.refreshToken !== "string") throw safeError();
      return { accessToken: value.accessToken, refreshToken: value.refreshToken };
    } catch { throw new Error("Managed installation credentials could not be decrypted."); }
  }
  #rollback(): void { try { this.#db.exec("ROLLBACK"); } catch { /* transaction already ended */ } }
}
