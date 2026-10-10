import { mkdir, chmod, unlink } from "node:fs/promises";
import { join } from "node:path";
import { McpReviewClient, NotionRestClient, SqliteWorkerStore, WorkerError, createShoppingWebhookWorker, type ReviewClient, type ShoppingWorker, type ShoppingWorkerConfig, type ShoppingWorkerEvent } from "../shopping-worker.ts";
import type { Installation, ManagedConfig } from "./types.ts";
import { ManagedStore } from "./store.ts";
import { NotionOAuthApi } from "./notion-api.ts";

type Fetcher = typeof fetch;

/** One process is the writer/refresh authority for this bounded managed pilot. */
export class ManagedRuntime {
  readonly #config: ManagedConfig;
  readonly #store: ManagedStore;
  readonly #api: NotionOAuthApi;
  readonly #reviewer: ReviewClient;
  readonly #fetch: Fetcher;
  readonly #workers = new Map<string, ShoppingWorker>();
  readonly #operations = new Map<string, Promise<unknown>>();
  readonly #refreshes = new Map<string, Promise<string>>();
  readonly #setups = new Map<string, AbortController>();
  readonly #controller = new AbortController();
  readonly #reviewSlots = new Slots(2);
  #closed = false;

  constructor(config: ManagedConfig, store: ManagedStore, api: NotionOAuthApi, reviewer: ReviewClient, fetcher: Fetcher = fetch) {
    this.#config = config; this.#store = store; this.#api = api; this.#reviewer = reviewer; this.#fetch = fetcher;
  }
  async start(): Promise<void> {
    await mkdir(this.#config.stateDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.#config.stateDirectory, 0o700);
    // Rebuild only installed processing state, never scan Notion workspaces.
    for (const installation of this.#store.list()) {
      if (installation.status === "disconnecting") await this.disconnect(installation.id);
      else if (installation.status === "active" || installation.status === "setting_up") void this.activate(installation.id, { reconcile: installation.status === "setting_up" }).catch(() => undefined);
    }
  }
  activate(id: string, options: { reconcile?: boolean; expectedGeneration?: number } = {}): Promise<void> {
    const requestedGeneration = options.expectedGeneration ?? this.#store.get(id)?.generation;
    return this.#serialize(id, async () => {
      this.#assertOpen();
      const original = this.#store.get(id);
      if (!original || original.status === "disconnecting") throw new WorkerError("Installation is unavailable", "revoked");
      if (original.generation !== requestedGeneration) return;
      const installation = this.#store.update(id, "setting_up", Date.now());
      this.#setups.get(id)?.abort();
      const setup = new AbortController();
      this.#setups.set(id, setup);
      const setupSignal = AbortSignal.any([setup.signal, this.#controller.signal]);
      await this.#stopWorker(id);
      try {
        let bound = installation;
        if (!bound.binding) {
          if (!bound.templatePageId) {
            this.#store.update(id, "setup_failed", Date.now(), { errorCode: "missing_template" });
            return;
          }
          const templateId = bound.templatePageId;
          const selectedRegion = bound.region;
          const binding = await this.#withAccess(id, installation.generation, setupSignal, (token) => this.#api.discoverList(token, templateId, selectedRegion, setupSignal));
          this.#fence(id, installation.generation);
          bound = this.#store.bind(id, installation.generation, binding, Date.now());

        }
        const binding = bound.binding;
        if (!binding) throw new WorkerError("Shopping template is unavailable", "invalid_config");
        if (options.reconcile) {
          const pages = await this.#withAccess(id, bound.generation, setupSignal, (token) => this.#api.listUnboughtPageIds(token, binding, setupSignal));
          this.#fence(id, bound.generation);
          const seed = new SqliteWorkerStore(this.#queuePath(id), { maxPendingPages: 1_000, maxDedupeRows: 5_000 });
          try { seed.reconcilePages(pages, Date.now() + 3_000, Date.now()); } finally { seed.close(); }
        }
        const generation = bound.generation;
        const path = this.#queuePath(id);
        const queue = new SqliteWorkerStore(path, { maxPendingPages: 1_000, maxDedupeRows: 5_000 });
        await chmod(path, 0o600);
        const tokenProvider = async () => this.#credentials(id, generation).accessToken;
        const fetcher: Fetcher = async (input, init) => {
          this.#fence(id, generation);
          const response = await this.#fetch(input, init);
          if (response.status !== 401) return response;
          await response.body?.cancel();
          const previous = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "");
          const next = await this.#refresh(id, generation, previous, init?.signal ?? this.#controller.signal);
          this.#fence(id, generation);
          const headers = new Headers(init?.headers);
          headers.set("authorization", `Bearer ${next}`);
          return this.#fetch(input, { ...init, headers });
        };
        const notion = new NotionRestClient(tokenProvider, fetcher);
        const reviewer: ReviewClient = {
          review: async (item, region, signal) => {
            const release = await this.#reviewSlots.acquire(signal);
            try {
              this.#fence(id, generation, true);
              const budget = this.#store.takeReview(id, Date.now(), this.#config.dailyReviewsPerInstallation, this.#config.dailyReviewsGlobal);
              if (!budget.allowed) throw new WorkerError("Shopping reviews are waiting for the daily budget", "temporary", Math.max(1_000, budget.retryAt - Date.now()));
              try { return await this.#reviewer.review(item, region, signal); }
              catch (error) {
                if (error instanceof WorkerError && error.code === "revoked") throw new WorkerError("Review service is temporarily unavailable", "temporary", 60_000);
                throw error;
              }
            } finally { release(); }
          },
        };
        const config: ShoppingWorkerConfig = {
          listenHost: "127.0.0.1", listenPort: 0, statePath: path,
          // Credentials are retrieved privately for each request; config is never serialized.
          notionApiToken: "managed-credential-provider", notionWebhookVerificationToken: this.#config.webhookVerificationToken,
          notionDataSourceId: binding.dataSourceId, notionDatabaseId: binding.databaseId, notionProperties: binding.properties,
          reviewMcpUrl: this.#config.reviewMcpUrl, reviewConnectionKey: "managed-review-client", region: bound.region, statusLabels: binding.statusLabels,
        };
        const worker = createShoppingWebhookWorker({
          config, notion, reviewer, store: queue, fingerprintNamespace: bound.region,
          onReady: () => {
            this.#fence(id, generation);
            this.#store.ready(id, generation, Date.now());
          },
          onPaused: (code) => {
            const current = this.#store.get(id);
            if (!current || current.generation !== generation || current.status === "disconnecting") return;
            this.#store.update(id, code === "revoked" ? "needs_reconnect" : "setup_failed", Date.now(), { errorCode: code === "revoked" ? "access_revoked" : "invalid_template" });
          },
        });
        // Readiness is asynchronous; management actions can still cancel startup.
        this.#workers.set(id, worker);
        void worker.start({ listen: false }).catch(() => {
          const current = this.#store.get(id);
          if (current?.generation === generation) this.#store.update(id, "setup_failed", Date.now(), { errorCode: "temporarily_unavailable" });
        });
      } catch (error) {
        await this.#stopWorker(id);
        const current = this.#store.get(id);
        if (!current || current.generation !== installation.generation || current.status === "disconnecting") return;
        const revoked = error instanceof WorkerError && error.code === "revoked";
        this.#store.update(id, revoked ? "needs_reconnect" : "setup_failed", Date.now(), {
          errorCode: revoked ? "access_revoked" : error instanceof WorkerError && error.code === "invalid_config" ? "invalid_template" : "temporarily_unavailable",
        });
      }
    });
  }
  async suspendForAuthorization(id: string): Promise<void> {
    if (!this.#store.get(id)) return;
    this.#store.update(id, "setting_up", Date.now());
    this.#setups.get(id)?.abort();
    await this.#serialize(id, () => this.#stopWorker(id));
  }
  pause(id: string): Promise<void> {
    this.#store.update(id, "paused", Date.now());
    this.#setups.get(id)?.abort();
    return this.#serialize(id, () => this.#stopWorker(id));
  }
  changeRegion(id: string, region: "UK" | "US"): Promise<void> {
    const next = this.#store.update(id, "setting_up", Date.now(), { region });
    this.#setups.get(id)?.abort();
    const setup = new AbortController();
    this.#setups.set(id, setup);
    const signal = AbortSignal.any([setup.signal, this.#controller.signal]);
    return this.#serialize(id, async () => {
      await this.#stopWorker(id);
      if (!next.binding) return true;
      try {
        const binding = next.binding;
        const pageIds = await this.#withAccess(id, next.generation, signal, (token) => this.#api.listUnboughtPageIds(token, binding, signal));
        this.#fence(id, next.generation);
        const queue = new SqliteWorkerStore(this.#queuePath(id), { maxPendingPages: 1_000, maxDedupeRows: 5_000 });
        try { queue.reconcilePages(pageIds, Date.now() + 3_000, Date.now()); }
        finally { queue.close(); }
        return true;
      } catch (error) {
        const current = this.#store.get(id);
        if (current?.generation === next.generation && current.status === "setting_up") this.#store.update(id, "setup_failed", Date.now(), { errorCode: "temporarily_unavailable" });
        if (signal.aborted || current?.generation !== next.generation) return false;
        throw error;
      }
    }).then((current) => current ? this.activate(id, { expectedGeneration: next.generation }) : undefined);
  }
  disconnect(id: string): Promise<{ permissionRemoved: boolean }> {
    const original = this.#store.get(id);
    if (!original) return Promise.resolve({ permissionRemoved: true });
    const credentials = this.#store.getCredentials(id);
    this.#store.update(id, "disconnecting", Date.now());
    this.#setups.get(id)?.abort();
    return this.#serialize(id, async () => {
      await this.#stopWorker(id); // Drain/abort active writes before reporting completion.
      let permissionRemoved = true;
      if (credentials) {
        try { await this.#api.revoke(credentials.accessToken, AbortSignal.timeout(10_000)); }
        catch { permissionRemoved = false; }
      }
      for (const suffix of ["", "-wal", "-shm"]) {
        try { await unlink(`${this.#queuePath(id)}${suffix}`); }
        catch (error) { if (!isMissingFile(error)) throw new Error("Private queue cleanup failed"); }
      }
      this.#store.remove(id);
      this.#setups.delete(id);
      return { permissionRemoved };
    });
  }
  enqueue(id: string, event: ShoppingWorkerEvent): ReturnType<ShoppingWorker["enqueue"]> {
    const installation = this.#store.get(id);
    if (!installation || installation.status === "disconnecting") return "ignored";
    if (installation.status === "paused" || installation.status === "needs_reconnect" || installation.status === "setup_failed") return "ignored";
    const worker = this.#workers.get(id);
    return worker ? worker.enqueue(event) : "paused";
  }
  state(id: string): { ready: boolean; paused: boolean } | undefined { return this.#workers.get(id)?.state(); }
  async stop(): Promise<void> {
    this.#closed = true;
    this.#controller.abort();
    await Promise.allSettled([...this.#operations.values()]);
    await Promise.allSettled([...this.#workers.values()].map((worker) => worker.stop()));
    this.#workers.clear();
    await Promise.allSettled([...this.#refreshes.values()]);
    await this.#reviewer.close?.();
  }
  #assertOpen(): void { if (this.#closed) throw new WorkerError("Service is stopping", "temporary"); }
  #fence(id: string, generation: number, requireActive = false): Installation {
    this.#assertOpen();
    const current = this.#store.get(id);
    if (!current || current.generation !== generation || (requireActive ? current.status !== "active" : !["active", "setting_up"].includes(current.status))) {
      throw new WorkerError("Installation processing was stopped", "revoked");
    }
    return current;
  }
  #credentials(id: string, generation: number) {
    this.#fence(id, generation);
    const credentials = this.#store.getCredentials(id);
    if (!credentials) throw new WorkerError("Connection needs to be renewed", "revoked");
    return credentials;
  }
  async #withAccess<T>(id: string, generation: number, signal: AbortSignal, operation: (token: string) => Promise<T>): Promise<T> {
    const credentials = this.#credentials(id, generation);
    try { return await operation(credentials.accessToken); }
    catch (error) {
      if (!(error instanceof WorkerError) || error.code !== "revoked") throw error;
      const token = await this.#refresh(id, generation, credentials.accessToken, signal);
      this.#fence(id, generation);
      return operation(token);
    }
  }
  async #refresh(id: string, generation: number, previous: string | undefined, signal: AbortSignal): Promise<string> {
    this.#fence(id, generation);
    const credentials = this.#credentials(id, generation);
    if (previous && credentials.accessToken !== previous) return credentials.accessToken;
    const pending = this.#refreshes.get(id);
    if (pending) return pending;
    const refresh = (async () => {
      try {
        signal.throwIfAborted();
        // Rotating credentials must be drained once dispatched, even if a shopper pauses.
        // The API has its own eight-second bound. CAS rejects disconnect or fresh authorization.
        const next = await this.#api.refresh(credentials.refreshToken, AbortSignal.timeout(15_000));
        if (!this.#store.replaceCredentials(id, credentials.accessToken, next)) throw new WorkerError("Connection changed while renewing access", "revoked");
        return next.accessToken;
      } catch {
        // A timed-out rotating-token response has an uncertain outcome. Reauthorization is safer than repeating it.
        const current = this.#store.get(id);
        if (current?.generation === generation && current.status !== "disconnecting") this.#store.update(id, "needs_reconnect", Date.now(), { errorCode: "access_revoked" });
        throw new WorkerError("Connection needs to be renewed", "revoked");
      }
    })();
    this.#refreshes.set(id, refresh);
    try { return await refresh; } finally { this.#refreshes.delete(id); }
  }
  #queuePath(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid internal installation ID");
    return join(this.#config.stateDirectory, `queue-${id}.sqlite`);
  }
  async #stopWorker(id: string): Promise<void> {
    const worker = this.#workers.get(id);
    this.#workers.delete(id);
    if (worker) await worker.stop();
    const refresh = this.#refreshes.get(id);
    if (refresh) await refresh.catch(() => undefined);
  }
  #serialize<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#operations.get(id) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(operation);
    this.#operations.set(id, pending);
    void pending.finally(() => { if (this.#operations.get(id) === pending) this.#operations.delete(id); }).catch(() => undefined);
    return pending;
  }
}

/** Abortable FIFO admission reserves released slots for existing waiters. */
class Slots {
  #active = 0;
  readonly #limit: number;
  readonly #waiting: Array<() => void> = [];
  constructor(limit: number) { this.#limit = limit; }
  async acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw signal.reason;
    if (this.#active < this.#limit) this.#active += 1;
    else await new Promise<void>((resolve, reject) => {
      const resume = () => { signal.removeEventListener("abort", abort); resolve(); };
      const abort = () => { const index = this.#waiting.indexOf(resume); if (index >= 0) this.#waiting.splice(index, 1); reject(signal.reason); };
      this.#waiting.push(resume);
      signal.addEventListener("abort", abort, { once: true });
    });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const next = this.#waiting.shift();
      if (next) next(); else this.#active -= 1;
    };
    if (signal.aborted) { release(); throw signal.reason; }
    return release;
  }
}

/** Shared Notion pacing across OAuth and all installed lists, with no payload retention. */
export function pacedNotionFetch(fetcher: typeof fetch = fetch): typeof fetch {
  const slots = new Slots(2);
  let reservedAt = 0;
  return async (input, init) => {
    const signal = init?.signal ?? AbortSignal.timeout(15_000);
    const release = await slots.acquire(signal);
    try {
      const startAt = Math.max(Date.now(), reservedAt + 334);
      reservedAt = startAt;
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return; }
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, Math.max(0, startAt - Date.now()));
        signal.addEventListener("abort", abort, { once: true });
      });
      return await fetcher(input, { ...init, redirect: "error" });
    } finally { release(); }
  };
}
function isMissingFile(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
export function createManagedReviewer(url: string, key: string): McpReviewClient { return new McpReviewClient(url, key); }
