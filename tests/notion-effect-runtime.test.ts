import { afterEach, describe, expect, it, vi } from "vitest";
import { runScopedMcpReview, type ScopedMcpClient } from "../integrations/notion/effect-runtime";
import { WorkerError } from "../integrations/notion/shopping-core";

function deferred<A = void>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe("managed Notion MCP Effect runtime", () => {
  it("registers cleanup before connect and closes after a hung connect is cancelled", async () => {
    const connecting = deferred();
    const closed = vi.fn(async () => undefined);
    const client: ScopedMcpClient = {
      connect: vi.fn(() => connecting.promise),
      close: closed,
    };
    const controller = new AbortController();
    const reason = new Error("action deadline");
    const run = runScopedMcpReview(() => client, controller.signal, async () => "unreachable");

    await vi.waitFor(() => expect(client.connect).toHaveBeenCalledTimes(1));
    controller.abort(reason);

    await expect(run).rejects.toBe(reason);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("bounds cleanup when close hangs and preserves the action cancellation reason", async () => {
    vi.useFakeTimers();
    const closeStarted = deferred();
    const client: ScopedMcpClient = {
      connect: async () => undefined,
      close: () => {
        closeStarted.resolve();
        return new Promise<void>(() => undefined);
      },
    };
    const controller = new AbortController();
    const reason = new Error("job cancelled");
    const run = runScopedMcpReview(() => client, controller.signal, async () => new Promise<string>(() => undefined));
    const outcome = run.then((value) => value, (error: unknown) => error);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort(reason);
    await closeStarted.promise;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(await outcome).toBe(reason);
  });

  it("keeps typed MCP failures intact across the Promise facade", async () => {
    const revoked = new WorkerError("MCP access denied", "revoked", undefined, "mcp");
    const client: ScopedMcpClient = {
      connect: async () => undefined,
      close: async () => undefined,
    };

    await expect(runScopedMcpReview(
      () => client,
      new AbortController().signal,
      async () => { throw revoked; },
    )).rejects.toBe(revoked);
  });

  it("classifies MCP handshake authorization failures as MCP revocations", async () => {
    const client: ScopedMcpClient = {
      connect: async () => { throw { data: { status: 401 } }; },
      close: async () => undefined,
    };

    await expect(runScopedMcpReview(
      () => client,
      new AbortController().signal,
      async () => "unreachable",
    )).rejects.toMatchObject({ code: "revoked", source: "mcp" });
  });
});
