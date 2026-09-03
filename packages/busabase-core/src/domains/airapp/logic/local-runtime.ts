import "server-only";

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { AirAppRuntimeEvent } from "busabase-contract/domains/airapp/contract";
import {
  getRuntimeDescriptor,
  type RunPlan,
  resolveRunPlan,
  substitutePort,
  tokenizeCommand,
} from "../utils/airapp-runtime-descriptor";
import { airAppRuntimeEnv } from "../utils/airapp-runtime-env";
import { registerLocalPreview, unregisterLocalPreview } from "./local-preview-registry";

/**
 * The `"local"` engine: the app's install/start commands run as bare OS
 * processes on the machine hosting Busabase.
 *
 * **Not isolated, deliberately.** The trust model is the host's own — this
 * engine is offered only where the host *is* the user's machine
 * (`allowHostProcesses`, see `logic/engine-availability.ts`). What that buys is
 * the thing isolation costs: a bare process's listening port is reachable from
 * the host, so the same-origin reverse-proxy preview
 * (`/api/airapp-preview/{nodeId}/`) and same-origin `/api/v1` data access both
 * work. It is the same trust model buda's `LocalPreviewCapability` uses.
 *
 * An OS-sandboxed variant of this engine (`"srt"`, via
 * `@anthropic-ai/sandbox-runtime`) used to live here and was removed. It was
 * never reachable: network-isolating the process also made its port
 * unreachable from the reverse proxy, so it could run an app but never preview
 * one, and `resolveAvailableAirAppEngines` consequently never offered it.
 * Isolated execution is now the `"remote"` engine's job
 * (`logic/sandock-runtime.ts`), which gets isolation *and* a preview by running
 * somewhere that can expose a port back.
 *
 * Workdir setup mirrors Buda's local agent runtime adapter (same
 * `SANDAGENT_WORKDIR` env var, same `path.resolve(process.cwd(), ...)` pattern)
 * rather than inventing a new convention.
 *
 * Exposed as a single long-lived async generator (consumed by the
 * `airapps.runLocal` oRPC event iterator) instead of separate
 * mount/install/start RPCs: install and start are naturally one continuous
 * operation from the server's point of view; the browser-side
 * `LocalRunner` fans this single stream back out into the `AirAppRunner`
 * interface's mount/install/start + onLog/onReady callback shape.
 */

/**
 * Default patterns for sniffing "the server is listening on N" out of a log
 * line. Sourced from the node runtime descriptor rather than duplicated, so the
 * two can't drift; a run uses its own `RunPlan.readyPatterns` instead, which is
 * how a Python app's uvicorn/flask banner gets recognised without this module
 * knowing Python exists.
 */
const READY_PORT_PATTERNS = getRuntimeDescriptor("node").readyPatterns;

/**
 * Asks the OS for a free TCP port by binding to port 0, reading the assigned
 * port, then releasing it. Used to give every BARE (`local`) run its own
 * `PORT` so concurrent bare runs don't fight over the host's port 3000
 * (EADDRINUSE). There is a small TOCTOU window between close() and the child
 * re-binding, which is acceptable for this dev-only feature.
 */
async function findFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address() as net.AddressInfo;
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Resolves once something is accepting TCP connections on `port`.
 *
 * Log sniffing alone is not enough once apps aren't all Node: a framework is
 * free to print its banner in any shape, or nothing at all, and then the
 * preview never loads even though the server is up and serving. When the author
 * declared a port we can simply ask the OS instead of guessing from prose. Runs
 * *alongside* sniffing rather than replacing it — whichever notices first wins.
 */
async function waitForPortOpen(port: number, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (!signal?.aborted && Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ port, host: "127.0.0.1" });
      const settle = (result: boolean) => {
        socket.destroy();
        resolve(result);
      };
      socket.once("connect", () => settle(true));
      socket.once("error", () => settle(false));
      socket.setTimeout(1_000, () => settle(false));
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export function detectPort(line: string, patterns: RegExp[] = READY_PORT_PATTERNS): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (match) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port > 0 && port < 65536) {
        return port;
      }
    }
  }
  return null;
}

export function resolveWorkdir(nodeId: string): string {
  const baseWorkdir = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    process.env.SANDAGENT_WORKDIR || ".tmp",
  );
  // Every run gets its own directory (not reused across runs) so a
  // "Run again" click never reuses a stale node_modules/dist from a
  // previous, possibly-different file set for the same AirApp node.
  return path.join(baseWorkdir, "airapp-runtime", nodeId, randomUUID());
}

/**
 * Materialize the caller's file set into `workdir`.
 *
 * `binaryFiles` arrives base64-encoded (the oRPC input is JSON, which has no
 * byte type) and is decoded back to raw bytes here. Writing those through the
 * text path instead would silently corrupt every image/font: `fs.writeFile`
 * with `"utf-8"` re-encodes lone bytes ≥ 0x80 as U+FFFD, so the file lands on
 * disk the right *name* and the wrong *contents*.
 */
export async function writeFiles(
  workdir: string,
  files: Record<string, string>,
  binaryFiles: Record<string, string> = {},
): Promise<void> {
  await fs.mkdir(workdir, { recursive: true });
  for (const [filePath, content] of Object.entries(files)) {
    const target = path.join(workdir, filePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf-8");
  }
  for (const [filePath, base64] of Object.entries(binaryFiles)) {
    const target = path.join(workdir, filePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(base64, "base64"));
  }
}

/**
 * Runs one command to completion, yielding decoded stdout/stderr chunks as
 * `log` lines (merged, matching the previous `LocalSandbox` behavior which
 * didn't distinguish the two streams) and resolving with the process exit code
 * once it finishes.
 */
async function* runCommand(
  command: string,
  workdir: string,
  signal?: AbortSignal,
  extraEnv?: Record<string, string>,
): AsyncGenerator<string, number | null> {
  // Quote-aware, not `command.split(" ")`: that was correct only for the two
  // commands this file used to hardcode. An author-supplied start command such
  // as `python -c "import app; app.run()"` became five broken argv entries and
  // failed with an error naming none of the real cause.
  const argv = tokenizeCommand(command);
  const env: NodeJS.ProcessEnv = process.env;

  // `detached: true` makes the child a process-group leader so the whole tree
  // can be signalled at once. This matters because the thing that actually
  // serves the app is a *grandchild*: `npm run dev` spawns `node server.js`,
  // and npm does not forward signals to it. Killing only the direct child —
  // which is all the `signal` spawn option does — left that grandchild running
  // on every tab close and every dev-server restart.
  //
  // A comment here used to claim `detached: true` was already being passed. It
  // was not; the option list was cwd/env/signal. That is why this is a fix and
  // not a refactor.
  const child: ChildProcess = spawn(argv[0], argv.slice(1), {
    cwd: workdir,
    env: { ...env, npm_config_cache: path.join(workdir, ".npm-cache"), ...extraEnv },
    detached: true,
  });

  // Negative pid = "the whole process group". Guarded because the group is
  // gone the moment the leader exits, and racing that is normal, not an error.
  const killProcessGroup = () => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  };
  const onAbort = () => killProcessGroup();
  signal?.addEventListener("abort", onAbort, { once: true });

  const queue: string[] = [];
  let waiter: (() => void) | null = null;
  let finished = false;
  let exitCode: number | null = null;
  let spawnError: Error | null = null;

  const wake = () => {
    waiter?.();
    waiter = null;
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    queue.push(chunk.toString("utf-8"));
    wake();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    queue.push(chunk.toString("utf-8"));
    wake();
  });
  child.on("error", (error: Error) => {
    spawnError = error;
    finished = true;
    wake();
  });
  child.on("exit", (code) => {
    exitCode = code;
    finished = true;
    wake();
  });

  try {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift() as string;
        continue;
      }
      if (finished) {
        break;
      }
      await new Promise<void>((resolve) => {
        waiter = resolve;
      });
    }
  } finally {
    // Reap the group unconditionally, not just on abort: a generator consumer
    // that stops iterating (an early `break`, or a thrown error upstream) runs
    // this `finally` without the signal ever aborting, and the dev server would
    // otherwise be left running with nobody holding a reference to it.
    signal?.removeEventListener("abort", onAbort);
    killProcessGroup();
  }

  if (spawnError && !signal?.aborted) {
    throw spawnError;
  }
  return exitCode;
}

/**
 * Streams the full mount -> install -> start lifecycle for one AirApp run.
 * The caller (the oRPC handler) passes its own AbortSignal through; aborting
 * it (the browser tab closing, or the caller disposing the runner) is what
 * kills the `npm run dev` child process — there is no separate dispose call.
 */
export async function* runAirAppLocal(
  input: {
    nodeId: string;
    files: Record<string, string>;
    binaryFiles?: Record<string, string>;
    engine: "local";
    /**
     * Who the run belongs to — scopes the preview registration so only this
     * person's proxy requests can find it.
     *
     * **Passed in, deliberately, rather than read from ambient context.** This
     * generator is driven by a run *session*, which outlives the request that
     * started it, so by the time most of it executes there is no request
     * context left to read. For the same reason the node-permission check is
     * NOT here: it lives in `run-session.ts`, where the caller's context still
     * exists. Anything calling this directly is therefore bypassing
     * authorization — don't; go through `runOrAttachSession`.
     */
    owner: string;
  },
  signal?: AbortSignal,
): AsyncGenerator<AirAppRuntimeEvent> {
  const owner = input.owner;
  const workdir = resolveWorkdir(input.nodeId);

  // What to run is decided once, here, from the app's own files — the engines
  // below execute a plan and never ask what language they are executing.
  let plan: RunPlan;
  try {
    plan = resolveRunPlan(input.files);
  } catch (error) {
    // A malformed `airapp.json` is an authoring mistake worth naming. Falling
    // back to defaults would run something the author did not ask for and hide
    // the typo behind whatever that produced.
    yield { type: "error", message: error instanceof Error ? error.message : String(error) };
    return;
  }

  // These runs share the HOST's network, so every concurrent run would
  // otherwise bind the same hardcoded :3000 (EADDRINUSE on the 2nd run).
  // Allocate a unique free port and inject it as `PORT`; the demos honor
  // `process.env.PORT` and log the actual port, so `detectPort` picks it up for
  // registration + the reverse proxy. An author-declared port wins: the app
  // presumably binds it unconditionally, so handing it a different one would
  // just guarantee a preview pointed at nothing.
  //
  // `airAppRuntimeEnv` is how the app learns it is Busabase-hosted rather than
  // standalone — under this engine it is reverse-proxied onto a sub-path of
  // busabase's origin, an environment no hostname test can classify correctly.
  // See `utils/airapp-runtime-env.ts`.
  const port = plan.port ?? (await findFreePort());
  // A runtime may need its own tool directory ahead of the system one — a
  // Python run installs into a per-run virtualenv, and the start command must
  // find that interpreter without either command naming the path. Resolved
  // against this run's workdir here; the descriptor deliberately doesn't know
  // where runs land on disk.
  const pathPrefix = plan.pathPrepend.map((entry) => path.join(workdir, entry));
  const extraEnv: Record<string, string> = {
    ...airAppRuntimeEnv(input.engine),
    PORT: String(port),
    ...(pathPrefix.length > 0
      ? { PATH: [...pathPrefix, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter) }
      : {}),
  };
  // `PORT` in the environment is the Node convention and covers Node apps.
  // Everything else needs the number in the command line itself — uvicorn reads
  // `--port`, not the environment, and silently binds 8000 otherwise.
  const installCommand = substitutePort(plan.install, port);
  const startCommand = substitutePort(plan.start, port);

  // The command generator currently running, so the `finally` below can close
  // it. Abandoning an async generator does NOT run its `finally`: when the
  // consumer of THIS generator stops iterating (a `break` on `ready`, an
  // upstream throw), our own `finally` runs but the inner one stays suspended
  // forever — and with it the process-group reap it owns. Every such run leaked
  // the whole `sh -> python3` tree.
  let activeCommand: AsyncGenerator<string, number | null> | null = null;
  let registeredPreviewTarget: string | null = null;

  try {
    await writeFiles(workdir, input.files, input.binaryFiles);

    // Say how the runtime was decided, before anything runs. Inference that
    // nobody can see is indistinguishable from a bug when it guesses wrong, and
    // the reviewer reading these logs did not write the app.
    yield { type: "log", line: `[busabase] ${plan.explanation}\n` };

    yield { type: "log", line: `$ ${installCommand}\n` };
    const installGen = runCommand(installCommand, workdir, signal, extraEnv);
    activeCommand = installGen;
    let installResult = await installGen.next();
    while (!installResult.done) {
      yield { type: "log", line: installResult.value };
      installResult = await installGen.next();
    }
    if (signal?.aborted) {
      return;
    }
    yield { type: "installed" };

    yield { type: "log", line: `$ ${startCommand}\n` };
    let sawReady = false;
    // NOTE: the abort path kills the direct child only; `npm run dev`'s
    // `node server.js` grandchild survives it. An earlier comment here claimed
    // `detached: true` made the process group reapable — it did not: the
    // `spawn` call in `runCommand` passes only cwd/env/signal. The real
    // process-group reap lands with the Stop/lifecycle work (see
    // `content/spec/airapp-runtime-engines.md`, defect D3); this comment states
    // what the code does today so the next reader isn't told it's already fixed.
    const devGen = runCommand(startCommand, workdir, signal, extraEnv);
    activeCommand = devGen;

    // Two independent ways to learn the server is up: its log banner (any
    // shape, any language) and — when the author declared the port — an actual
    // TCP probe. Racing them means an app that logs nothing recognisable still
    // previews, instead of running invisibly behind a spinner.
    let portProbe: Promise<void> | null =
      plan.port === undefined ? null : waitForPortOpen(port, signal);
    let pendingNext: Promise<IteratorResult<string, number | null>> | null = null;

    const markReady = async (readyPort: number) => {
      // A URL, not a port: the proxy forwards to whatever origin an engine
      // registers, so a remote engine can reuse the same-origin preview path.
      registeredPreviewTarget = `http://127.0.0.1:${readyPort}`;
      await registerLocalPreview(input.nodeId, owner, registeredPreviewTarget);
    };

    let exitCode: number | null = null;
    while (true) {
      if (!pendingNext) pendingNext = devGen.next();
      let devResult: IteratorResult<string, number | null>;

      if (portProbe && !sawReady) {
        const winner = await Promise.race([
          pendingNext.then((value) => ({ kind: "gen" as const, value })),
          portProbe.then(() => ({ kind: "port" as const })),
        ]);
        if (winner.kind === "port") {
          portProbe = null;
          if (!sawReady && !signal?.aborted) {
            sawReady = true;
            await markReady(port);
            yield { type: "ready", previewUrl: `/api/airapp-preview/${input.nodeId}/` };
          }
          // `pendingNext` is deliberately still outstanding — the next loop
          // iteration awaits the same promise rather than requesting a second
          // value from the generator.
          continue;
        }
        devResult = winner.value;
      } else {
        devResult = await pendingNext;
      }
      pendingNext = null;
      if (devResult.done) {
        exitCode = devResult.value;
        break;
      }

      const text = devResult.value;
      yield { type: "log", line: text };
      if (!sawReady) {
        const detected = detectPort(text, plan.readyPatterns);
        if (detected) {
          sawReady = true;
          // Register the port so the same-origin reverse proxy
          // (`/api/airapp-preview/{nodeId}/…`) can forward to this real
          // localhost process, and emit that same-origin sub-path as the
          // preview URL instead of the cross-origin `http://localhost:${port}`.
          // (Underscore-prefixed route folders like `__airapp_preview__` are
          // treated as private and excluded from Next.js routing, so the route
          // lives under `/api/airapp-preview`.) The proxy injects a matching
          // `<base href>` into HTML responses, so the app's relative asset
          // links resolve under this sub-path regardless of trailing-slash
          // normalization. Same-origin is what lets the running app use the
          // same-origin `/api/v1` data access.
          await markReady(detected);
          yield { type: "ready", previewUrl: `/api/airapp-preview/${input.nodeId}/` };
        }
      }
    }
    if (!signal?.aborted) {
      yield { type: "exit", code: exitCode };
    }
  } catch (error) {
    if (!signal?.aborted) {
      yield { type: "error", message: error instanceof Error ? error.message : String(error) };
    }
  } finally {
    // Closing the inner generator is what actually kills the app: it runs the
    // `finally` in `runCommand`, which reaps the process group.
    await activeCommand?.return(null).catch(() => undefined);
    if (registeredPreviewTarget) {
      await unregisterLocalPreview(input.nodeId, owner, registeredPreviewTarget);
    }
  }
}
