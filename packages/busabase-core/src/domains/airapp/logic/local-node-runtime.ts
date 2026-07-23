import "server-only";

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { AirAppRuntimeEvent } from "busabase-contract/domains/airapp/contract";
import { registerLocalPreview, unregisterLocalPreview } from "./local-preview-registry";

/**
 * Server-side execution engine backing BOTH the `"local-node"` and `"srt"`
 * `AirAppRunnerKind`s: a real `npm install` + `npm run dev` OS process. The
 * ONLY difference between the two engines is whether the commands are wrapped
 * by `@anthropic-ai/sandbox-runtime`'s `SandboxManager`:
 *
 * - `"local-node"` (bare): commands are spawned directly on the host running
 *   the Next.js server (no srt). This is NOT OS-isolated — the trust model is
 *   the local host. Because a bare process's listening port IS host-reachable,
 *   the same-origin reverse-proxy preview (`/api/airapp-preview/{nodeId}/`) and
 *   the `/__busabase_api__/` data bridge both work — the same trust model
 *   buda's `LocalPreviewCapability` uses for its local runtime.
 * - `"srt"` (sandboxed): commands are wrapped for actual OS-level isolation
 *   (seccomp/bubblewrap on Linux, `sandbox-exec` on macOS) — writes are
 *   confined to this run's workdir and network access is limited to the npm
 *   registry. Isolated execution + logs work, but the live web preview is
 *   UNAVAILABLE because srt network-isolates the process, so its app port is
 *   not reachable from the host reverse proxy (a documented, verified
 *   limitation — the `ready`/preview events still fire; the iframe just won't
 *   load).
 *
 * Workdir setup mirrors `apps/buda`'s
 * `agent/logic/runtime/local-agent-runtime-adapter.ts` `createSandbox()`
 * (same `SANDAGENT_WORKDIR` env var, same `path.resolve(process.cwd(), ...)`
 * pattern) rather than inventing a new convention. Unlike `NodepodRunner` (a
 * virtual, in-browser filesystem + process), both engines spawn a real
 * process on the host running the Next.js server.
 *
 * Exposed as a single long-lived async generator (consumed by the
 * `airapps.runLocalNode` oRPC event iterator) instead of separate
 * mount/install/start RPCs: install and start are naturally one continuous
 * operation from the server's point of view; the browser-side
 * `LocalNodeRunner` fans this single stream back out into the `AirAppRunner`
 * interface's mount/install/start + onLog/onReady callback shape.
 *
 * IMPORTANT — concurrency (srt only): `SandboxManager` is a process-wide
 * singleton (its own doc comment: "Global sandbox manager that handles both
 * network and filesystem restrictions for this session"). Since busabase-cloud
 * is a single Next.js server process that can field concurrent `runLocalNode`
 * calls from different users/spaces, two concurrent srt runs initializing the
 * singleton with different `workdir`/`allowWrite` configs would race and
 * corrupt each other's sandbox boundaries. The sandbox mutex below serializes
 * the whole initialize -> run -> reset sequence so only one srt run's sandbox
 * is active on the server at a time; other concurrent requests wait their
 * turn. Bare `local-node` runs don't touch the singleton, so they don't
 * acquire the lock. This is an accepted trade-off (throughput for
 * correctness/safety) — see the accompanying changelog.
 */

let sandboxLock: Promise<void> = Promise.resolve();

/**
 * Acquires the process-wide sandbox mutex, returning a release callback.
 * Used (rather than a wrapper that takes a callback) because the caller is
 * an async generator: it needs to hold the lock across many `yield` points,
 * not just for the duration of a single awaited call.
 */
export async function acquireSandboxLock(): Promise<() => void> {
  let release!: () => void;
  const previous = sandboxLock;
  sandboxLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  return release;
}

const READY_PORT_PATTERNS = [
  /listening on port\s*:?\s*(\d{2,5})/i,
  /localhost:(\d{2,5})/i,
  /0\.0\.0\.0:(\d{2,5})/i,
  /listening on\s*:?\s*(\d{2,5})/i,
];

/**
 * Asks the OS for a free TCP port by binding to port 0, reading the assigned
 * port, then releasing it. Used to give every BARE (`local-node`) run its own
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

export function detectPort(line: string): number | null {
  for (const pattern of READY_PORT_PATTERNS) {
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

export async function writeFiles(workdir: string, files: Record<string, string>): Promise<void> {
  await fs.mkdir(workdir, { recursive: true });
  for (const [filePath, content] of Object.entries(files)) {
    const target = path.join(workdir, filePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf-8");
  }
}

export function buildSandboxConfig(workdir: string): SandboxRuntimeConfig {
  return {
    network: {
      // Allow-only pattern (verified in the package README): all network
      // access is denied by default, so an empty `deniedDomains` combined
      // with a populated `allowedDomains` already yields default-deny for
      // every other domain — no need for a `deniedDomains: ["*"]` entry.
      allowedDomains: ["registry.npmjs.org", "*.npmjs.org", "registry.npmmirror.com"],
      deniedDomains: [],
    },
    filesystem: {
      // Deny-then-allow for reads (default allow everywhere): only need to
      // block sensitive host paths, mirroring the README's own example.
      denyRead: ["~/.ssh", "~/.aws", "~/.gnupg", "~/.config"],
      // Allow-only for writes (default deny everywhere): scope strictly to
      // this run's workdir. `npm install`'s cache is redirected into the
      // workdir too (see `npm_config_cache` below) so we don't have to
      // widen this to the host's global `~/.npm` cache.
      allowWrite: [workdir],
      denyWrite: [],
    },
  };
}

/**
 * Runs one sandboxed command to completion, yielding decoded stdout/stderr
 * chunks as `log` lines (merged, matching the previous `LocalSandbox`
 * behavior which didn't distinguish the two streams) and resolving with the
 * process exit code once it finishes.
 */
async function* runSandboxedCommand(
  command: string,
  workdir: string,
  sandboxed: boolean,
  signal?: AbortSignal,
  extraEnv?: Record<string, string>,
): AsyncGenerator<string, number | null> {
  // `sandboxed` selects the engine: `true` = "srt" (wrap in the OS sandbox),
  // `false` = "local-node" (spawn bare on the host, so the listening port is
  // reachable from the reverse proxy — srt network-isolates the process, which
  // makes its port unreachable and breaks the live preview).
  let argv: string[];
  let env: NodeJS.ProcessEnv;
  if (sandboxed) {
    ({ argv, env } = await SandboxManager.wrapWithSandboxArgv(
      command,
      undefined,
      undefined,
      signal,
      workdir,
    ));
  } else {
    argv = command.split(" ");
    env = process.env;
  }

  const child: ChildProcess = spawn(argv[0], argv.slice(1), {
    cwd: workdir,
    env: { ...env, npm_config_cache: path.join(workdir, ".npm-cache"), ...extraEnv },
    signal,
  });

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
    // Aborting the run's signal (browser close / dispose) kills the direct
    // child via the spawn `signal` above. NOTE: `npm run dev`'s grandchild
    // (`node server.js`) can outlive an abort because npm doesn't forward the
    // signal — a known resource leak (dev-only feature; the leaked process
    // holds its OWN unique port, so it never blocks a new run, and all such
    // processes die when the dev server restarts). A robust process-group reap
    // is a documented follow-up.
    if (sandboxed) {
      SandboxManager.cleanupAfterCommand();
    }
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
export async function* runAirAppLocalNode(
  input: { nodeId: string; files: Record<string, string>; engine: "local-node" | "srt" },
  signal?: AbortSignal,
): AsyncGenerator<AirAppRuntimeEvent> {
  const workdir = resolveWorkdir(input.nodeId);
  const sandboxed = input.engine === "srt";

  // BARE (`local-node`) runs share the HOST's network, so every concurrent run
  // would otherwise bind the same hardcoded :3000 (EADDRINUSE on the 2nd run).
  // Allocate a unique free port and inject it as `PORT`; the demos honor
  // `process.env.PORT` and log the actual port, so `detectPort` picks it up for
  // registration + the reverse proxy. srt network-isolates each run's :3000, so
  // it keeps the current behavior (no PORT injection).
  const extraEnv: Record<string, string> | undefined = sandboxed
    ? undefined
    : { PORT: String(await findFreePort()) };

  // See the file-level doc comment: SandboxManager is a process-wide
  // singleton, so for the srt engine the whole initialize -> run -> reset
  // sequence must be serialized against any other concurrent srt run on this
  // server. Bare local-node runs don't touch the singleton, so they skip the
  // lock (and the initialize/reset/dep-check) entirely.
  const release = sandboxed ? await acquireSandboxLock() : null;

  try {
    await writeFiles(workdir, input.files);

    if (sandboxed) {
      const depCheck = SandboxManager.checkDependencies();
      if (!SandboxManager.isSupportedPlatform() || depCheck.errors.length > 0) {
        // Fail open with a loud, visible warning rather than either silently
        // running unsandboxed (defeats the whole point) or hard-failing every
        // run on a host that's simply missing an optional binary (e.g. no
        // `socat` on a bare dev box). Operators can see this in the run log.
        yield {
          type: "log",
          line:
            `[warning] OS-level sandboxing is NOT fully active on this host ` +
            `(${depCheck.errors.join("; ") || "unsupported platform"}). ` +
            `AirApp srt commands will run with reduced or no isolation.\n`,
        };
      }

      await SandboxManager.initialize(buildSandboxConfig(workdir));
    }

    yield { type: "log", line: "$ npm install\n" };
    const installGen = runSandboxedCommand("npm install", workdir, sandboxed, signal, extraEnv);
    let installResult = await installGen.next();
    while (!installResult.done) {
      yield { type: "log", line: installResult.value };
      installResult = await installGen.next();
    }
    if (signal?.aborted) {
      return;
    }
    yield { type: "installed" };

    yield { type: "log", line: "$ npm run dev\n" };
    let sawReady = false;
    // `detached: true` (last arg) makes the dev server a process-group leader
    // so its `node server.js` grandchild is reaped on abort/teardown (both
    // engines — leaking grandchildren is bad regardless of sandboxing).
    const devGen = runSandboxedCommand("npm run dev", workdir, sandboxed, signal, extraEnv);
    let devResult = await devGen.next();
    while (!devResult.done) {
      const text = devResult.value;
      yield { type: "log", line: text };
      if (!sawReady) {
        const port = detectPort(text);
        if (port) {
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
          // `/__busabase_api__/` data bridge.
          registerLocalPreview(input.nodeId, port);
          yield { type: "ready", previewUrl: `/api/airapp-preview/${input.nodeId}/` };
        }
      }
      devResult = await devGen.next();
    }
    if (!signal?.aborted) {
      yield { type: "exit", code: devResult.value };
    }
  } catch (error) {
    if (!signal?.aborted) {
      yield { type: "error", message: error instanceof Error ? error.message : String(error) };
    }
  } finally {
    unregisterLocalPreview(input.nodeId);
    if (sandboxed) {
      await SandboxManager.reset().catch(() => undefined);
    }
    release?.();
  }
}
