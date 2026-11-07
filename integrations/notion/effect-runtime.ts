import { Cause, Context, Effect, Exit, Layer, Option } from "effect";
import { WorkerError, isRecord } from "./shopping-core";

const MCP_CONNECT_TIMEOUT_MS = 15_000;
const MCP_CLEANUP_TIMEOUT_MS = 1_000;

export interface ScopedMcpClient {
  connect(signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

type ReviewRuntimeService = {
  withClient<Client extends ScopedMcpClient, Result>(
    createClient: () => Client,
    actionSignal: AbortSignal,
    reviewWithClient: (client: Client, signal: AbortSignal) => Promise<Result>,
  ): Effect.Effect<Result, unknown>;
};
type CloseOutcome = "closed" | "timed_out" | "failed";

class ReviewRuntime extends Context.Service<ReviewRuntime, ReviewRuntimeService>()(
  "eat-or-yeet/notion/ReviewRuntime",
) {
  static readonly layer = Layer.succeed(ReviewRuntime, ReviewRuntime.of({
    withClient: (createClient, actionSignal, reviewWithClient) => Effect.scoped(
      Effect.gen(function*() {
        const client = yield* Effect.acquireRelease(
          Effect.sync(createClient),
          (acquired) => Effect.tryPromise({
            try: () => closeWithin(acquired, MCP_CLEANUP_TIMEOUT_MS),
            catch: () => new Error("MCP client cleanup failed"),
          }).pipe(
            Effect.catch(() => Effect.succeed<CloseOutcome>("failed")),
            Effect.flatMap((outcome) => outcome === "closed"
              ? Effect.void
              : Effect.sync(() => console.warn(outcome === "timed_out"
                ? "Notion MCP client cleanup exceeded its one-second bound"
                : "Notion MCP client cleanup failed"))),
          ),
        );

        yield* Effect.tryPromise({
          try: (fiberSignal) => connectWithin(
            client,
            AbortSignal.any([actionSignal, fiberSignal]),
            MCP_CONNECT_TIMEOUT_MS,
          ),
          catch: classifyConnectFailure,
        });

        return yield* Effect.tryPromise({
          try: (fiberSignal) => reviewWithClient(client, AbortSignal.any([actionSignal, fiberSignal])),
          catch: (error) => error,
        });
      }),
    ),
  }));
}

/** Promise facade for managed actions that need a fresh, scoped MCP connection. */
export async function runScopedMcpReview<Client extends ScopedMcpClient, Result>(
  createClient: () => Client,
  actionSignal: AbortSignal,
  reviewWithClient: (client: Client, signal: AbortSignal) => Promise<Result>,
): Promise<Result> {
  const program = Effect.gen(function*() {
    const runtime = yield* ReviewRuntime;
    return yield* runtime.withClient(createClient, actionSignal, reviewWithClient);
  }).pipe(Effect.provide(ReviewRuntime.layer));

  const exit = await Effect.runPromiseExit(program, { signal: actionSignal });
  if (Exit.isSuccess(exit)) return exit.value;

  const typedFailure = Cause.findErrorOption(exit.cause);
  if (Option.isSome(typedFailure)) throw typedFailure.value;
  if (actionSignal.aborted) throw actionSignal.reason;
  throw Cause.squash(exit.cause);
}

async function connectWithin(
  client: ScopedMcpClient,
  actionSignal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([actionSignal, timeoutSignal]);
  try {
    await raceAbort(client.connect(signal), signal);
  } catch (error) {
    if (actionSignal.aborted) throw actionSignal.reason;
    if (timeoutSignal.aborted) {
      throw new WorkerError("Review MCP connection timed out", "temporary", undefined, "mcp");
    }
    throw error;
  }
}

function raceAbort<A>(promise: Promise<A>, signal: AbortSignal): Promise<A> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<A>((resolve, reject) => {
    let settled = false;
    const finish = (resume: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resume();
    };
    const onAbort = () => finish(() => reject(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function classifyConnectFailure(error: unknown): unknown {
  if (error instanceof WorkerError) return error;
  if (isRecord(error) && isRecord(error.data) && [401, 403].includes(Number(error.data.status))) {
    return new WorkerError("Review MCP access was revoked or denied", "revoked", undefined, "mcp");
  }
  return error;
}

function closeWithin(client: ScopedMcpClient, timeoutMs: number): Promise<CloseOutcome> {
  return new Promise<CloseOutcome>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish("timed_out"), timeoutMs);
    const finish = (outcome: CloseOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    try {
      client.close().then(() => finish("closed"), () => finish("failed"));
    } catch {
      finish("failed");
    }
  });
}
