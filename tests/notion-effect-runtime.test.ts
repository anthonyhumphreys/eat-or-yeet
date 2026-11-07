import { spawnSync } from "node:child_process";
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

  it("does not start an already-cancelled SDK handshake or leak a late connect rejection", () => {
    const effectRuntimeUrl = new URL("../integrations/notion/effect-runtime.ts", import.meta.url).href;
    const shoppingCoreUrl = new URL("../integrations/notion/shopping-core.ts", import.meta.url).href;
    const script = `
      import assert from "node:assert/strict";
      import { runScopedMcpReview } from ${JSON.stringify(effectRuntimeUrl)};
      import { McpReviewClient } from ${JSON.stringify(shoppingCoreUrl)};

      const unhandled = [];
      process.on("unhandledRejection", (reason) => unhandled.push(reason));
      let networkCalls = 0;
      globalThis.fetch = async () => {
        networkCalls += 1;
        throw new Error("unexpected network request");
      };

      const alreadyCancelled = new AbortController();
      const deadline = new Error("deadline expired before MCP admission");
      alreadyCancelled.abort(deadline);
      await assert.rejects(
        runScopedMcpReview(
          () => new McpReviewClient("https://example.test/mcp", "not-a-real-key"),
          alreadyCancelled.signal,
          async () => undefined,
        ),
        (error) => error === deadline,
      );

      const connecting = new AbortController();
      const actionReason = new Error("deadline fired during connect");
      const handshakeFailure = new Error("late handshake rejection");
      let closeCount = 0;
      await assert.rejects(
        runScopedMcpReview(
          () => ({
            connect: () => {
              connecting.abort(actionReason);
              return Promise.reject(handshakeFailure);
            },
            close: async () => { closeCount += 1; },
          }),
          connecting.signal,
          async () => undefined,
        ),
        (error) => error === actionReason,
      );

      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(closeCount, 1);
      assert.equal(networkCalls, 0);
      assert.deepEqual(unhandled, []);
    `;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 5_000,
    });

    expect(child.status, child.error?.message || child.stderr || child.stdout).toBe(0);
  });
});
