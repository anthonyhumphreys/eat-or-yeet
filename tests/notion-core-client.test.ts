import { afterEach, describe, expect, it, vi } from "vitest";
import { NotionRestClient, WorkerError } from "../integrations/notion/shopping-core.ts";

const cleanups: Array<() => Promise<void>> = [];
function deferred<A = void>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((done) => { resolve = done; });
  return { promise, resolve };
}
function harness() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const gates = new Map<string, { promise: Promise<Response>; resolve: (response: Response) => void }>();
  const controllers: AbortController[] = [];
  const requests: Promise<unknown>[] = [];
  const active = new Set<string>();
  const started: string[] = [];
  let peak = 0;
  function gate(id: string) {
    let entry = gates.get(id);
    if (!entry) {
      let resolve!: (response: Response) => void;
      const promise = new Promise<Response>((done) => { resolve = done; });
      entry = { promise, resolve };
      gates.set(id, entry);
    }
    return entry;
  }
  const client = new NotionRestClient("test-token", (input) => {
    const id = new URL(input).pathname.split("/").at(-1)!;
    started.push(id);
    active.add(id);
    peak = Math.max(peak, active.size);
    return gate(id).promise;
  });
  function request(id: string, controller = new AbortController()) {
    controllers.push(controller);
    const result: Promise<unknown> = client.getPage(id, controller.signal).then((value) => value, (error: unknown) => error);
    requests.push(result);
    return result;
  }
  function release(id: string) {
    active.delete(id);
    gate(id).resolve(Response.json({ id }));
  }
  cleanups.push(async () => {
    for (const controller of controllers) controller.abort(new Error("test cleanup"));
    for (const id of gates.keys()) release(id);
    await vi.runAllTimersAsync();
    await Promise.all(requests);
  });
  return { request, release, started, peak: () => peak };
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.useRealTimers();
});

describe("Notion REST request admission", () => {
  it("rejects an already-aborted request without fetching or consuming a slot", async () => {
    const controller = new AbortController();
    const reason = new Error("already cancelled");
    controller.abort(reason);
    const fetcher = vi.fn(async () => Response.json({ id: "live" }));
    const client = new NotionRestClient("test-token", fetcher);
    await expect(client.getPage("cancelled", controller.signal)).rejects.toBe(reason);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(client.getPage("live", new AbortController().signal)).resolves.toEqual({ id: "live" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("tags Notion authorization failures with their provider source", async () => {
    const client = new NotionRestClient("test-token", async () => new Response("unauthorized", { status: 401 }));
    await expect(client.getPage("private-page", new AbortController().signal)).rejects.toMatchObject({
      code: "revoked",
      source: "notion",
    } satisfies Partial<WorkerError>);
  });

  it("removes cancelled waiters so surviving and subsequent requests finish after held requests drain", async () => {
    const context = harness();
    const first = context.request("first");
    const second = context.request("second");
    await vi.advanceTimersByTimeAsync(334);
    expect(context.started).toEqual(["first", "second"]);
    const cancelledA = new AbortController();
    const cancelledB = new AbortController();
    const reason = new Error("queued cancellation");
    const discardedA = context.request("cancelled-a", cancelledA);
    const discardedB = context.request("cancelled-b", cancelledB);
    const liveA = context.request("live-a");
    const liveB = context.request("live-b");
    cancelledA.abort(reason);
    cancelledB.abort(reason);
    expect(await discardedA).toBe(reason);
    expect(await discardedB).toBe(reason);
    context.release("first");
    context.release("second");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(context.started).toEqual(["first", "second", "live-a", "live-b"]);
    context.release("live-a");
    context.release("live-b");
    expect(await Promise.all([first, second, liveA, liveB])).toEqual([{ id: "first" }, { id: "second" }, { id: "live-a" }, { id: "live-b" }]);
    const subsequent = context.request("subsequent");
    await vi.advanceTimersByTimeAsync(334);
    context.release("subsequent");
    expect(await subsequent).toEqual({ id: "subsequent" });
    expect(context.peak()).toBeLessThanOrEqual(2);
  });

  it("reserves a released slot for the queued request before admitting a new arrival", async () => {
    const context = harness();
    context.request("first");
    context.request("second");
    await vi.advanceTimersByTimeAsync(334);
    const queued = context.request("queued");
    let arrival: Promise<unknown> | undefined;
    context.release("first");
    queueMicrotask(() => { arrival = context.request("arrival"); });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(context.started).toEqual(["first", "second", "queued"]);
    expect(context.peak()).toBe(2);
    context.release("queued");
    await vi.advanceTimersByTimeAsync(334);
    expect(context.started).toEqual(["first", "second", "queued", "arrival"]);
    context.release("arrival");
    context.release("second");
    expect(await queued).toEqual({ id: "queued" });
    expect(await arrival).toEqual({ id: "arrival" });
    expect(context.peak()).toBe(2);
  });

  it("honors Retry-After for transient GETs and stops after the bounded attempt count", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => new Response("temporary", { status: 503, headers: { "retry-after": "2" } }));
    const client = new NotionRestClient("test-token", fetcher);
    const pending = client.getPage("retry-page", new AbortController().signal).then(
      (value) => value,
      (error: unknown) => error,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);

    const failure = await pending;
    expect(failure).toMatchObject({ code: "temporary" });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("honors cancellation while waiting to retry a transient GET", async () => {
    const started = deferred<void>();
    const fetcher = vi.fn(async () => {
      started.resolve();
      return new Response("temporary", { status: 503, headers: { "retry-after": "30" } });
    });
    const controller = new AbortController();
    const reason = new Error("cancel retry");
    const client = new NotionRestClient("test-token", fetcher);
    const pending = client.getPage("cancel-retry", controller.signal);
    await started.promise;
    await Promise.resolve();
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
