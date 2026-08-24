import "server-only";

import type { AirAppRuntimeEvent } from "busabase-contract/domains/airapp/contract";

/** The engines that run server-side. `nodepod` never reaches this layer — it is the browser. */
type AirAppRunnerEngine = "local" | "srt" | "sandock";

import { assertNodePermission } from "../../../logic/node-acl";
import { currentPreviewOwner } from "./local-preview-registry";
import { runAirAppLocal } from "./local-runtime";
import { runAirAppSandock } from "./sandock-runtime";

/**
 * A run is a **session**, not a request.
 *
 * Before this, a run *was* its oRPC stream: `runAirAppLocal` was consumed
 * directly by the handler, so when the stream ended — tab closed, page
 * reloaded, user navigated to another node — the run ended with it. That
 * coupling is why closing a tab used to strand a process: the only thing
 * holding the app was a connection that had just gone away.
 *
 * The product decision is the opposite: an app keeps running when you look
 * away, so coming back is instant and navigating off mid-install doesn't throw
 * the install away. That requires something that outlives any one stream, and
 * this is it. A stream is now a *subscriber*: attaching replays what the run
 * has already produced and then follows it live; detaching does nothing to the
 * process.
 *
 * What ends a run, then, is explicit: `stopRunSession`, or the idle sweeper
 * below. Nothing else. The reaper is designed on the assumption that **Stop is
 * never clicked**, because for most sessions it won't be.
 *
 * Keyed by `(nodeId, owner)` — the same key the preview registry uses, for the
 * same two reasons: each reviewer gets their own isolated run, and one
 * reviewer's run is not reachable by another.
 */

/** Keep the tail of a run's output so a reattaching client isn't shown a blank Logs tab. */
const MAX_BUFFERED_LOG_CHUNKS = 2000;

/**
 * How long a run may sit with nobody watching before it is reclaimed.
 *
 * This is the only automatic brake on resource use: opening an AirApp starts it,
 * every reviewer gets their own, and runs survive navigation, so the population
 * of live runs grows from ordinary browsing rather than from anyone deciding to
 * start something.
 */
export const DEFAULT_IDLE_TTL_MS = 15 * 60 * 1000;

const SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * How many runs one owner may have going at once.
 *
 * Needed because runs accumulate from *browsing*, not from anyone deciding to
 * start something: opening a node runs it, and runs survive navigation. Without
 * a ceiling, reading through a folder of AirApps provisions one per node and
 * every one of them stays up until its idle window lapses.
 *
 * Hitting it evicts the least-recently-watched run rather than refusing the new
 * one. Refusing would ask the user to go and clean up runs they never asked to
 * start — and the run they are looking at right now is self-evidently the one
 * they care about.
 */
export const DEFAULT_MAX_RUNS_PER_OWNER = 3;

/** How long a finished run's output stays readable before the session is dropped. */
const TERMINAL_RETENTION_MS = 5 * 60 * 1000;

export type RunSessionStatus = "installing" | "running" | "exited" | "failed";

interface RunSession {
  nodeId: string;
  owner: string;
  /** Replayed to every client that attaches, in order. */
  buffer: AirAppRuntimeEvent[];
  status: RunSessionStatus;
  subscribers: Set<(event: AirAppRuntimeEvent) => void>;
  attached: number;
  /** `null` while somebody is watching. */
  idleSince: number | null;
  terminalSince: number | null;
  abort: AbortController;
  finished: Promise<void>;
}

/** owner -> nodeId -> session. Nested for the same anti-forgery reason as the preview registry. */
const sessions = new Map<string, Map<string, RunSession>>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

const getOwnerBucket = (owner: string): Map<string, RunSession> | undefined => sessions.get(owner);

const readSession = (nodeId: string, owner: string): RunSession | undefined =>
  getOwnerBucket(owner)?.get(nodeId);

const dropSession = (nodeId: string, owner: string): void => {
  const bucket = getOwnerBucket(owner);
  if (!bucket) return;
  bucket.delete(nodeId);
  if (bucket.size === 0) sessions.delete(owner);
};

const putSession = (session: RunSession): void => {
  const bucket = getOwnerBucket(session.owner) ?? new Map<string, RunSession>();
  bucket.set(session.nodeId, session);
  sessions.set(session.owner, bucket);
};

/** Terminal sessions are kept briefly so a reload can still read why a run ended. */
const isTerminal = (session: RunSession): boolean =>
  session.status === "exited" || session.status === "failed";

const record = (session: RunSession, event: AirAppRuntimeEvent): void => {
  // Only `log` is high-volume and safe to drop the head of. The others are
  // state transitions a late subscriber still needs in order to render
  // anything sensible, so they are never evicted.
  if (event.type === "log") {
    session.buffer.push(event);
    if (session.buffer.length > MAX_BUFFERED_LOG_CHUNKS) {
      const firstLog = session.buffer.findIndex((entry) => entry.type === "log");
      if (firstLog >= 0) session.buffer.splice(firstLog, 1);
    }
  } else {
    session.buffer.push(event);
  }

  switch (event.type) {
    case "installed":
      session.status = "running";
      break;
    case "exit":
      // A dev server that exits has stopped serving, whatever its code says.
      // Leaving the status at "running" is what used to let the UI keep
      // claiming success over a dead preview.
      session.status = event.code === 0 ? "exited" : "failed";
      session.terminalSince = Date.now();
      break;
    case "error":
      session.status = "failed";
      session.terminalSince = Date.now();
      break;
    default:
      break;
  }

  for (const subscriber of session.subscribers) subscriber(event);
};

const startSweeper = (): void => {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void sweepIdleRunSessions();
  }, SWEEP_INTERVAL_MS);
  // Never hold the process open just to run the sweeper.
  sweepTimer.unref?.();
};

/**
 * The second of the design's two legitimate "name the concrete implementations"
 * sites (the other is `runner-factory.ts`). Everything downstream consumes the
 * same event stream, so nothing else in the system needs to know which engine
 * produced it.
 */
const runtimeFor = (
  engine: AirAppRunnerEngine,
  input: {
    nodeId: string;
    files: Record<string, string>;
    binaryFiles?: Record<string, string>;
    owner: string;
  },
  signal: AbortSignal,
): AsyncGenerator<AirAppRuntimeEvent> => {
  switch (engine) {
    case "sandock":
      return runAirAppSandock(input, signal);
    case "local":
    case "srt":
      return runAirAppLocal({ ...input, engine }, signal);
    default: {
      const exhaustive: never = engine;
      throw new Error(`Unknown AirApp engine: ${exhaustive}`);
    }
  }
};

const beginSession = (
  input: { nodeId: string; files: Record<string, string>; binaryFiles?: Record<string, string> },
  engine: AirAppRunnerEngine,
  owner: string,
): RunSession => {
  const abort = new AbortController();
  const session: RunSession = {
    nodeId: input.nodeId,
    owner,
    buffer: [],
    status: "installing",
    subscribers: new Set(),
    attached: 0,
    idleSince: Date.now(),
    terminalSince: null,
    abort,
    finished: Promise.resolve(),
  };

  session.finished = (async () => {
    try {
      for await (const event of runtimeFor(
        engine,
        { nodeId: input.nodeId, files: input.files, binaryFiles: input.binaryFiles, owner },
        abort.signal,
      )) {
        record(session, event);
      }
    } catch (error) {
      record(session, {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (!isTerminal(session)) {
        session.status = "failed";
        session.terminalSince = Date.now();
      }
    }
  })();

  putSession(session);
  startSweeper();
  return session;
};

/**
 * Make room for one more run, oldest-unwatched-first.
 *
 * Attached sessions are evicted last and only if nothing else is available:
 * somebody is looking at those. Among unwatched ones the longest-idle goes
 * first, which is the closest thing to "the one you have most stopped caring
 * about" that the server can observe.
 */
const enforceOwnerLimit = async (owner: string, limit: number): Promise<void> => {
  const bucket = getOwnerBucket(owner);
  if (!bucket) return;

  while (bucket.size >= limit) {
    const candidates = [...bucket.values()].sort((a, b) => {
      if (a.attached !== b.attached) return a.attached - b.attached;
      return (a.idleSince ?? Number.POSITIVE_INFINITY) - (b.idleSince ?? Number.POSITIVE_INFINITY);
    });
    const victim = candidates[0];
    if (!victim) return;
    victim.abort.abort();
    await victim.finished.catch(() => undefined);
    dropSession(victim.nodeId, owner);
  }
};

/**
 * Start a run, or attach to the one already going for this `(nodeId, owner)`.
 *
 * Attaching rather than starting a second run is what makes a page reload feel
 * instant and stops a reload from re-running `npm install`. It is also why the
 * caller's abort signal only detaches: the stream ending means "this viewer
 * left", which is not a reason to kill anybody's app.
 */
export async function* runOrAttachSession(
  input: {
    nodeId: string;
    files: Record<string, string>;
    binaryFiles?: Record<string, string>;
    engine: AirAppRunnerEngine;
  },
  signal?: AbortSignal,
): AsyncGenerator<AirAppRuntimeEvent> {
  // The permission check lives here, in the caller's request context, and not
  // in `runAirAppLocal` — that generator now runs detached from any request, so
  // it must not depend on ambient context to decide who may do what.
  await assertNodePermission(input.nodeId, "write");
  const owner = currentPreviewOwner();

  const existing = readSession(input.nodeId, owner);
  let session: RunSession;
  if (existing && !isTerminal(existing)) {
    session = existing;
  } else {
    // A finished run is not something to attach to: the viewer would get a dead
    // preview and no way forward. Clear it out and start fresh.
    if (existing) dropSession(input.nodeId, owner);
    await enforceOwnerLimit(owner, DEFAULT_MAX_RUNS_PER_OWNER);
    session = beginSession(input, input.engine, owner);
  }

  const queue: AirAppRuntimeEvent[] = [...session.buffer];
  let wake: (() => void) | null = null;
  const subscriber = (event: AirAppRuntimeEvent) => {
    queue.push(event);
    wake?.();
    wake = null;
  };

  session.subscribers.add(subscriber);
  session.attached += 1;
  session.idleSince = null;

  const onAbort = () => {
    wake?.();
    wake = null;
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (!signal?.aborted) {
      if (queue.length > 0) {
        yield queue.shift() as AirAppRuntimeEvent;
        continue;
      }
      if (isTerminal(session)) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    session.subscribers.delete(subscriber);
    session.attached = Math.max(0, session.attached - 1);
    // Detaching does NOT stop the run. This is the whole point of the session:
    // the idle clock starts, and only the sweeper or an explicit Stop ends it.
    if (session.attached === 0) session.idleSince = Date.now();
  }
}

/** Explicit teardown, from the Run panel's Stop control. */
export async function stopRunSession(nodeId: string): Promise<{ stopped: boolean }> {
  await assertNodePermission(nodeId, "write");
  const owner = currentPreviewOwner();
  const session = readSession(nodeId, owner);
  if (!session) return { stopped: false };

  session.abort.abort();
  await session.finished.catch(() => undefined);
  dropSession(nodeId, owner);
  return { stopped: true };
}

/**
 * Reclaim runs nobody is watching, and drop the remains of finished ones.
 *
 * Exported (rather than only running on the interval) so it can be driven
 * directly by a test and by a host scheduler: an interval that only exists
 * inside this module is not something an operator can reason about.
 */
export async function sweepIdleRunSessions(
  now: number = Date.now(),
  idleTtlMs: number = DEFAULT_IDLE_TTL_MS,
): Promise<number> {
  let reclaimed = 0;
  for (const [owner, bucket] of [...sessions.entries()]) {
    for (const [nodeId, session] of [...bucket.entries()]) {
      if (isTerminal(session)) {
        if (
          session.terminalSince !== null &&
          now - session.terminalSince >= TERMINAL_RETENTION_MS
        ) {
          dropSession(nodeId, owner);
          reclaimed += 1;
        }
        continue;
      }
      if (
        session.attached === 0 &&
        session.idleSince !== null &&
        now - session.idleSince >= idleTtlMs
      ) {
        session.abort.abort();
        await session.finished.catch(() => undefined);
        dropSession(nodeId, owner);
        reclaimed += 1;
      }
    }
  }
  return reclaimed;
}

/** Test seam: drop every session without waiting on timers. */
export async function __resetRunSessionsForTest(): Promise<void> {
  for (const bucket of sessions.values()) {
    for (const session of bucket.values()) {
      session.abort.abort();
      await session.finished.catch(() => undefined);
    }
  }
  sessions.clear();
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/** Test/diagnostic view of what is currently running. */
export function listRunSessions(): Array<{
  nodeId: string;
  owner: string;
  status: RunSessionStatus;
  attached: number;
}> {
  const out: Array<{ nodeId: string; owner: string; status: RunSessionStatus; attached: number }> =
    [];
  for (const bucket of sessions.values()) {
    for (const session of bucket.values()) {
      out.push({
        nodeId: session.nodeId,
        owner: session.owner,
        status: session.status,
        attached: session.attached,
      });
    }
  }
  return out;
}
