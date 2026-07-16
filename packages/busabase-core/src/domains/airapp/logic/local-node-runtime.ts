import "server-only";

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { AirAppRuntimeEvent } from "busabase-contract/domains/airapp/contract";

/**
 * Server-side execution engine backing the `"local-node"` `AirAppRunnerKind`:
 * a real `npm install` + `npm run dev` OS process, wrapped in
 * `@anthropic-ai/sandbox-runtime`'s `SandboxManager` for actual OS-level
 * isolation (seccomp/bubblewrap on Linux, `sandbox-exec` on macOS) — writes
 * are confined to this run's workdir and network access is limited to the
 * npm registry, mirroring `apps/buda`'s
 * `agent/logic/runtime/local-agent-runtime-adapter.ts` `createSandbox()`
 * workdir setup (same `SANDAGENT_WORKDIR` env var, same
 * `path.resolve(process.cwd(), ...)` pattern) rather than inventing a new
 * convention. Unlike `NodepodRunner` (a virtual, in-browser filesystem +
 * process), this spawns a real (sandboxed) process on the host running the
 * Next.js server — the same trust model buda's `LocalPreviewCapability`
 * already uses for its local runtime (`http://localhost:{port}` is directly
 * reachable by the browser because both processes share one host).
 *
 * Exposed as a single long-lived async generator (consumed by the
 * `airapps.runLocalNode` oRPC event iterator) instead of separate
 * mount/install/start RPCs: install and start are naturally one continuous
 * operation from the server's point of view; the browser-side
 * `LocalNodeRunner` fans this single stream back out into the `AirAppRunner`
 * interface's mount/install/start + onLog/onReady callback shape.
 *
 * IMPORTANT — concurrency: `SandboxManager` is a process-wide singleton (its
 * own doc comment: "Global sandbox manager that handles both network and
 * filesystem restrictions for this session"). Since busabase-cloud is a
 * single Next.js server process that can field concurrent
 * `runLocalNode` calls from different users/spaces, two concurrent runs
 * initializing the singleton with different `workdir`/`allowWrite` configs
 * would race and corrupt each other's sandbox boundaries. `withSandboxLock`
 * below serializes the whole initialize -> run -> reset sequence so only one
 * AirApp local-node run's sandbox is active on the server at a time; other
 * concurrent requests simply wait their turn. This is an accepted trade-off
 * (throughput for correctness/safety) — see the accompanying changelog.
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
  const baseWorkdir = path.resolve(process.cwd(), process.env.SANDAGENT_WORKDIR || ".tmp");
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
  signal?: AbortSignal,
): AsyncGenerator<string, number | null> {
  const { argv, env } = await SandboxManager.wrapWithSandboxArgv(
    command,
    undefined,
    undefined,
    signal,
    workdir,
  );

  const child: ChildProcess = spawn(argv[0], argv.slice(1), {
    cwd: workdir,
    env: { ...env, npm_config_cache: path.join(workdir, ".npm-cache") },
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
    SandboxManager.cleanupAfterCommand();
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
  input: { nodeId: string; files: Record<string, string> },
  signal?: AbortSignal,
): AsyncGenerator<AirAppRuntimeEvent> {
  const workdir = resolveWorkdir(input.nodeId);

  // See the file-level doc comment: SandboxManager is a process-wide
  // singleton, so the whole initialize -> run -> reset sequence must be
  // serialized against any other concurrent local-node run on this server.
  const release = await acquireSandboxLock();

  try {
    await writeFiles(workdir, input.files);

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
          `AirApp local-node commands will run with reduced or no isolation.\n`,
      };
    }

    await SandboxManager.initialize(buildSandboxConfig(workdir));

    yield { type: "log", line: "$ npm install\n" };
    const installGen = runSandboxedCommand("npm install", workdir, signal);
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
    const devGen = runSandboxedCommand("npm run dev", workdir, signal);
    let devResult = await devGen.next();
    while (!devResult.done) {
      const text = devResult.value;
      yield { type: "log", line: text };
      if (!sawReady) {
        const port = detectPort(text);
        if (port) {
          sawReady = true;
          yield { type: "ready", previewUrl: `http://localhost:${port}` };
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
    await SandboxManager.reset().catch(() => undefined);
    release();
  }
}
