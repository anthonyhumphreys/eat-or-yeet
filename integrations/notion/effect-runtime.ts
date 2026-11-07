import { Cause, Effect, Exit, Option } from "effect";
import { WorkerError, isRecord } from "./shopping-core";

const MCP_CONNECT_TIMEOUT_MS = 15_000;
const MCP_CLEANUP_TIMEOUT_MS = 1_000;

export interface ScopedMcpClient {
  connect(signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

export type McpOperationPhase = "connect" | "review";

/** An unexpected SDK rejection, kept distinct from WorkerError and interruption. */
export class McpOperationError extends Error {
  readonly _tag = "McpOperationError";

  constructor(readonly phase: McpOperationPhase, cause: unknown) {
    super(`Notion MCP ${phase} failed`, { cause });
    this.name = "McpOperationError";
  }
}

export type McpReviewError = WorkerError | McpOperationError;
type CloseOutcome = "closed" | "timed_out" | "failed";

/** Builds a lazy, typed Effect around one scoped MCP connection. */
export function scopedMcpReview<Client extends ScopedMcpClient, Result>(
  createClient: () => Client,
  reviewWithClient: (client: Client, signal: AbortSignal) => Promise<Result>,
): Effect.Effect<Result, McpReviewError> {
  return Effect.scoped(
    Effect.gen(function*() {
      const client = yield* Effect.acquireRelease(
        Effect.sync(createClient),
        (acquired) => Effect.promise(() => closeWithin(acquired, MCP_CLEANUP_TIMEOUT_MS)).pipe(
          Effect.flatMap((outcome) => outcome === "closed"
            ? Effect.void
            : Effect.sync(() => console.warn(outcome === "timed_out"
              ? "Notion MCP client cleanup exceeded its one-second bound"
              : "Notion MCP client cleanup failed"))),
        ),
      );

      yield* Effect.tryPromise({
        try: (fiberSignal) => connectWithin(client, fiberSignal, MCP_CONNECT_TIMEOUT_MS),
        catch: classifyConnectFailure,
      });

      return yield* Effect.tryPromise({
        try: (fiberSignal) => reviewWithClient(client, fiberSignal),
        catch: (cause) => classifyReviewFailure(cause),
      });
    }),
  );
}

/** Promise facade for managed actions that need a fresh, scoped MCP connection. */
export async function runScopedMcpReview<Client extends ScopedMcpClient, Result>(
  createClient: () => Client,
  actionSignal: AbortSignal,
  reviewWithClient: (client: Client, signal: AbortSignal) => Promise<Result>,
): Promise<Result> {
  if (actionSignal.aborted) throw actionSignal.reason;

  const exit = await Effect.runPromiseExit(
    scopedMcpReview(createClient, reviewWithClient),
    { signal: actionSignal },
  );
  if (Exit.isSuccess(exit)) return exit.value;

  const typedFailure = Cause.findErrorOption(exit.cause);
  if (Option.isSome(typedFailure)) {
    const error = typedFailure.value;
    if (error instanceof McpOperationError) throw error.cause;
    throw error;
  }
  if (actionSignal.aborted) throw actionSignal.reason;
  throw Cause.squash(exit.cause);
}

async function connectWithin(
  client: ScopedMcpClient,
  fiberSignal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([fiberSignal, timeoutSignal]);
  try {
    if (signal.aborted) throw signal.reason;
    await raceAbort(client.connect(signal), signal);
  } catch (error) {
    if (fiberSignal.aborted) throw fiberSignal.reason;
    if (timeoutSignal.aborted) {
      throw new WorkerError("Review MCP connection timed out", "temporary", undefined, "mcp");
    }
    throw error;
  }
}

function raceAbort<A>(promise: Promise<A>, signal: AbortSignal): Promise<A> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
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

function classifyConnectFailure(error: unknown): McpReviewError {
  if (error instanceof WorkerError) return error;
  if (isRecord(error) && isRecord(error.data) && [401, 403].includes(Number(error.data.status))) {
    return new WorkerError("Review MCP access was revoked or denied", "revoked", undefined, "mcp");
  }
  return new McpOperationError("connect", error);
}

function classifyReviewFailure(error: unknown): McpReviewError {
  if (error instanceof WorkerError) return error;
  return new McpOperationError("review", error);
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
