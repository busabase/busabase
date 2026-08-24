import type { AirAppRuntimeEvent } from "busabase-contract/domains/airapp/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The session layer is the thing that makes a run outlive its stream, so every
 * assertion here is about a boundary that used not to exist: detaching must not
 * kill, reattaching must not restart, and the only two things that end a run are
 * an explicit stop and the idle sweeper.
 */

vi.mock("../../../logic/node-acl", () => ({
  assertNodePermission: vi.fn(async () => undefined),
}));

/** Owner is ambient in production; pinned here so the tests can talk about two of them. */
let currentOwner = "user-1";
vi.mock("./local-preview-registry", () => ({
  currentPreviewOwner: () => currentOwner,
  LOCAL_PREVIEW_OWNER: "local",
}));

/**
 * A controllable stand-in for the real runtime: the test decides when the app
 * emits, and whether it ever finishes. `runs` counts starts, which is how
 * "attach did not start a second install" is asserted.
 */
let runs = 0;
let emit: ((event: AirAppRuntimeEvent) => void) | null = null;
let finish: (() => void) | null = null;
let aborted = false;

vi.mock("./local-runtime", () => ({
  runAirAppLocal: async function* (
    _input: unknown,
    signal?: AbortSignal,
  ): AsyncGenerator<AirAppRuntimeEvent> {
    runs += 1;
    const queue: AirAppRuntimeEvent[] = [];
    let wake: (() => void) | null = null;
    let done = false;

    emit = (event) => {
      queue.push(event);
      wake?.();
      wake = null;
    };
    finish = () => {
      done = true;
      wake?.();
      wake = null;
    };
    const onAbort = () => {
      aborted = true;
      done = true;
      wake?.();
      wake = null;
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      while (!done || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift() as AirAppRuntimeEvent;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  },
}));

const INPUT = {
  nodeId: "node-1",
  files: { "package.json": "{}" },
  engine: "local" as const,
};

/** Drain whatever a subscriber can currently see, then detach. */
const attachAndCollect = async (
  session: AsyncGenerator<AirAppRuntimeEvent>,
  count: number,
): Promise<AirAppRuntimeEvent[]> => {
  const seen: AirAppRuntimeEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const next = await session.next();
    if (next.done) break;
    seen.push(next.value);
  }
  await session.return(undefined as never);
  return seen;
};

let mod: typeof import("./run-session");

beforeEach(async () => {
  runs = 0;
  emit = null;
  finish = null;
  aborted = false;
  currentOwner = "user-1";
  mod = await import("./run-session");
  await mod.__resetRunSessionsForTest();
});

afterEach(async () => {
  await mod.__resetRunSessionsForTest();
});

describe("run sessions", () => {
  it("keeps the run alive after the stream that started it detaches", async () => {
    const first = mod.runOrAttachSession(INPUT);
    const firstEvent = first.next();
    // Let the session start before emitting into it.
    await vi.waitFor(() => expect(emit).not.toBeNull());
    emit?.({ type: "log", line: "installing\n" });
    await firstEvent;
    await first.return(undefined as never);

    // Detaching is not stopping — this is the entire point of the layer.
    expect(aborted).toBe(false);
    expect(mod.listRunSessions()).toHaveLength(1);
    expect(mod.listRunSessions()[0]?.attached).toBe(0);
  });

  it("replays what a reattaching viewer missed instead of restarting", async () => {
    const first = mod.runOrAttachSession(INPUT);
    const pending = first.next();
    await vi.waitFor(() => expect(emit).not.toBeNull());
    emit?.({ type: "log", line: "step one\n" });
    emit?.({ type: "installed" });
    emit?.({ type: "ready", previewUrl: "/api/airapp-preview/node-1/" });
    await pending;
    await first.return(undefined as never);

    const replayed = await attachAndCollect(mod.runOrAttachSession(INPUT), 3);

    // One run, not two — a reload must not re-run `npm install`.
    expect(runs).toBe(1);
    expect(replayed.map((event) => event.type)).toEqual(["log", "installed", "ready"]);
    expect(replayed[0]).toEqual({ type: "log", line: "step one\n" });
  });

  it("gives two owners separate runs of the same node", async () => {
    const a = mod.runOrAttachSession(INPUT);
    const firstA = a.next();
    await vi.waitFor(() => expect(runs).toBe(1));
    emit?.({ type: "log", line: "a\n" });
    await firstA;
    await a.return(undefined as never);

    currentOwner = "user-2";
    const b = mod.runOrAttachSession(INPUT);
    const firstB = b.next();
    await vi.waitFor(() => expect(runs).toBe(2));
    emit?.({ type: "log", line: "b\n" });
    await firstB;
    await b.return(undefined as never);

    expect(mod.listRunSessions()).toHaveLength(2);
    expect(
      mod
        .listRunSessions()
        .map((s) => s.owner)
        .sort(),
    ).toEqual(["user-1", "user-2"]);
  });

  it("stops a run on request, and treats stopping nothing as a non-error", async () => {
    const stream = mod.runOrAttachSession(INPUT);
    const pending = stream.next();
    await vi.waitFor(() => expect(emit).not.toBeNull());
    emit?.({ type: "log", line: "up\n" });
    await pending;
    await stream.return(undefined as never);

    expect(await mod.stopRunSession("node-1")).toEqual({ stopped: true });
    expect(aborted).toBe(true);
    expect(mod.listRunSessions()).toHaveLength(0);

    // Stopping again must not throw — the button can be clicked twice, and a
    // reaper may have got there first.
    expect(await mod.stopRunSession("node-1")).toEqual({ stopped: false });
  });

  it("reclaims a run nobody is watching, and leaves a watched one alone", async () => {
    const watched = mod.runOrAttachSession({ ...INPUT, nodeId: "watched" });
    const pending = watched.next();
    await vi.waitFor(() => expect(emit).not.toBeNull());
    emit?.({ type: "log", line: "hi\n" });
    await pending;
    // Deliberately still attached.

    const idle = mod.runOrAttachSession({ ...INPUT, nodeId: "idle" });
    const idlePending = idle.next();
    await vi.waitFor(() => expect(runs).toBe(2));
    emit?.({ type: "log", line: "hi\n" });
    await idlePending;
    await idle.return(undefined as never);

    expect(mod.listRunSessions()).toHaveLength(2);

    // Well past the TTL. The watched session has an attached viewer, so its
    // idle clock never started.
    const reclaimed = await mod.sweepIdleRunSessions(Date.now() + 60 * 60 * 1000, 60_000);

    expect(reclaimed).toBe(1);
    expect(mod.listRunSessions().map((s) => s.nodeId)).toEqual(["watched"]);

    await watched.return(undefined as never);
  });

  it("marks a run that exits non-zero as failed rather than leaving it 'running'", async () => {
    // The bug this pins: a dev server crashing *after* install used to emit a
    // log line and nothing else, so the UI kept claiming success over a dead
    // preview, forever.
    const stream = mod.runOrAttachSession(INPUT);
    const pending = stream.next();
    await vi.waitFor(() => expect(emit).not.toBeNull());
    emit?.({ type: "installed" });
    await pending;

    emit?.({ type: "exit", code: 1 });
    await stream.next();
    await stream.return(undefined as never);

    expect(mod.listRunSessions()[0]?.status).toBe("failed");
  });

  it("starts a fresh run when the previous one has already finished", async () => {
    const stream = mod.runOrAttachSession(INPUT);
    const pending = stream.next();
    await vi.waitFor(() => expect(emit).not.toBeNull());
    emit?.({ type: "exit", code: 0 });
    await pending;
    finish?.();
    await stream.return(undefined as never);

    // An async generator is lazy: nothing in `runOrAttachSession` executes until
    // the first `next()`. Asking for zero events would assert against a
    // function that never ran.
    const second = mod.runOrAttachSession(INPUT);
    const secondPending = second.next();
    await vi.waitFor(() => expect(runs).toBe(2));
    emit?.({ type: "log", line: "fresh\n" });
    await secondPending;
    await second.return(undefined as never);

    // Attaching to a corpse would show a dead preview and no way forward.
    expect(runs).toBe(2);
  });
});

describe("per-owner concurrency cap", () => {
  // Waits on the run *counter*, not on `emit` being non-null: `emit` is a
  // module-level handle overwritten by each generator, so after the first run it
  // is always non-null and a waiter on it passes instantly — sending the event
  // to the previous generator while the new session waits forever.
  const startAndDetach = async (nodeId: string, expectedRuns: number) => {
    const stream = mod.runOrAttachSession({ ...INPUT, nodeId });
    const pending = stream.next();
    await vi.waitFor(() => expect(runs).toBe(expectedRuns));
    emit?.({ type: "log", line: `${nodeId}\n` });
    await pending;
    await stream.return(undefined as never);
  };

  it("evicts the longest-idle run rather than refusing the new one", async () => {
    // These runs were never *asked for* — they came from opening nodes. So the
    // cap must not turn browsing into an error the user has to clean up after.
    const ids = ["a", "b", "c"];
    for (const [index, nodeId] of ids.entries()) {
      await startAndDetach(nodeId, index + 1);
    }
    expect(mod.listRunSessions()).toHaveLength(3);

    await startAndDetach("d", 4);

    const live = mod.listRunSessions().map((s) => s.nodeId);
    expect(live).toHaveLength(3);
    expect(live).toContain("d");
    // "a" was idle longest.
    expect(live).not.toContain("a");
  });

  it("keeps the run someone is actually watching", async () => {
    const ids = ["x", "y"];
    for (const [index, nodeId] of ids.entries()) {
      await startAndDetach(nodeId, index + 1);
    }
    // Still attached — somebody is looking at this one.
    const watched = mod.runOrAttachSession({ ...INPUT, nodeId: "watched" });
    const pending = watched.next();
    await vi.waitFor(() => expect(runs).toBe(3));
    emit?.({ type: "log", line: "watched\n" });
    await pending;

    await startAndDetach("newest", 4);

    const live = mod.listRunSessions().map((s) => s.nodeId);
    expect(live).toContain("watched");
    expect(live).toContain("newest");

    await watched.return(undefined as never);
  });
});
