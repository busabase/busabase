import "server-only";

import type { AirAppRuntimeEvent } from "busabase-contract/domains/airapp/contract";
import { createSandockClient } from "sandock";
import { type RunPlan, resolveRunPlan, substitutePort } from "../utils/airapp-runtime-descriptor";
import { airAppRuntimeEnv } from "../utils/airapp-runtime-env";
import { registerLocalPreview, unregisterLocalPreview } from "./local-preview-registry";

/**
 * The `"remote"` engine, as implemented by Sandock: an AirApp running on a
 * machine provisioned per run instead of on the Busabase host.
 *
 * Sandock is named here, in the adapter, and nowhere in the contract — the wire
 * value is `"remote"`, which is the property the caller is choosing. Swapping
 * this provider is then a change to this file plus `runtimeFor`'s switch, not a
 * breaking change to every AirApp manifest that pinned an engine.
 *
 * **There is no per-language work in this file, and that is the point.** A
 * sandbox is a machine with a shell; "supporting Python" is not a feature
 * anyone builds into it, it is what a container already does. So this hands the
 * app's `RunPlan` — install command, start command, port — straight through and
 * never learns what language it is running. Compare `local-runtime.ts`, which
 * needs a per-runtime `PATH` prefix and network allowlist only because it
 * shares a host with everything else.
 *
 * Two things genuinely differ from the local engine, and both are consequences
 * of the app being *somewhere else*:
 *
 * 1. **The port is declared, not discovered.** Sandock does not watch the
 *    process's output for a port, so the caller says which one to expose. The
 *    manifest's `port` (or the runtime default) supplies it.
 * 2. **The dev server has to be backgrounded explicitly.** `shell` is a
 *    request/response call that returns when the command exits, and a dev server
 *    never exits — running it in the foreground would simply hang until the
 *    timeout. It is started detached, writing to a log file this generator then
 *    tails, which is how output still reaches the Logs tab.
 */

const APP_DIR = "/workspace/airapp";
const APP_LOG = "/tmp/airapp.log";

/** Long enough for a cold `pip install`/`npm install` on a slow network. */
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/** How often to pull new output out of the backgrounded dev server's log. */
const LOG_POLL_MS = 700;

/**
 * A backstop reaper that does not depend on Busabase being alive.
 *
 * Busabase's own idle sweeper (`run-session.ts`) is the primary one, but it
 * lives in a process that can be restarted, redeployed or simply crash — and a
 * leaked *local* process is a stale row on someone's own machine, whereas a
 * leaked *remote* sandbox is a bill. Sandock is told to expire the sandbox on
 * its own clock as well, so a Busabase-side failure cannot keep one alive
 * indefinitely.
 */
const SANDBOX_DEADLINE_SECONDS = 4 * 60 * 60;
const SANDBOX_CPU_MILLICORES = 500;
const SANDBOX_MEMORY_LIMIT_MB = 500;

const PREVIEW_URL_TTL_SECONDS = 3600;

/** Do not expose an iframe until Sandock can actually reach the app port. */
const PREVIEW_READY_TIMEOUT_MS = 60_000;
const PREVIEW_PROBE_TIMEOUT_MS = 5_000;
/** Avoid exposing the iframe during a transient first-success window. */
const PREVIEW_READY_CONSECUTIVE_SUCCESSES = 3;

/** Keep Stop responsive even when Sandock or its Kubernetes provider is unhealthy. */
const CLEANUP_ATTEMPTS = 2;
const CLEANUP_TIMEOUT_MS = 60_000;

class CleanupTimeoutError extends Error {}

interface ReusableSandbox {
  id: string;
  config: SandockConfig;
}

/** owner -> nodeId -> stopped sandbox. Run sessions enforce one live run per key. */
const reusableSandboxes = new Map<string, Map<string, ReusableSandbox>>();

const readReusableSandbox = (owner: string, nodeId: string): ReusableSandbox | undefined =>
  reusableSandboxes.get(owner)?.get(nodeId);

const dropReusableSandbox = (owner: string, nodeId: string, id?: string): void => {
  const bucket = reusableSandboxes.get(owner);
  if (!bucket) return;
  const current = bucket.get(nodeId);
  if (id && current?.id !== id) return;
  bucket.delete(nodeId);
  if (bucket.size === 0) reusableSandboxes.delete(owner);
};

const putReusableSandbox = (owner: string, nodeId: string, sandbox: ReusableSandbox): void => {
  const bucket = reusableSandboxes.get(owner) ?? new Map<string, ReusableSandbox>();
  bucket.set(nodeId, sandbox);
  reusableSandboxes.set(owner, bucket);
};

const hasSameSandboxConfiguration = (cached: SandockConfig, current: SandockConfig): boolean =>
  cached.baseUrl === current.baseUrl &&
  cached.spaceId === current.spaceId &&
  cached.image === current.image;

export interface SandockConfig {
  baseUrl: string;
  apiKey: string;
  spaceId?: string;
  image?: string;
}

const DEFAULT_SANDOCK_BASE_URL = "https://sandock.ai";

/**
 * Sandock is available when it is *configured*, not when the deployment happens
 * to be the cloud one. A self-hoster who would rather not run app processes on
 * their own box can point at a Sandock and get the same engine.
 */
export function resolveSandockConfig(env: NodeJS.ProcessEnv = process.env): SandockConfig | null {
  const apiKey = env.SANDOCK_API_KEY?.trim();
  if (!apiKey) return null;
  const configuredBaseUrl = env.SANDOCK_BASE_URL?.trim() || DEFAULT_SANDOCK_BASE_URL;

  let baseUrl: string;
  try {
    const parsed = new URL(configuredBaseUrl);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    baseUrl = parsed.origin;
  } catch {
    return null;
  }

  return {
    baseUrl,
    apiKey,
    spaceId: env.SANDOCK_SPACE_ID?.trim() || undefined,
    image: env.SANDOCK_IMAGE?.trim() || undefined,
  };
}

/**
 * The base URL is the server's origin, with **no** `/api/v1` appended: the SDK
 * itself hardcodes that prefix onto every request path, so adding it here
 * produced `/api/v1/api/v1/sandbox` and a flat `Not Found` that named nothing.
 * Found by running against a real Sandock — the recording stand-in in the unit
 * tests never sees a URL, so it could not have caught this.
 *
 * This is the same published `sandock` SDK `apps/buda` already depends on —
 * not `sandock-contract`, which is an internal oRPC contract package meant for
 * Sandock's own three apps (`sandock-core`, `apps/sandock`, `apps/sandock-cloud`)
 * and reaches into `@orpc/*` types that never belonged in a published surface.
 */
const client = (config: SandockConfig) =>
  createSandockClient({
    baseUrl: config.baseUrl.replace(/\/+$/, ""),
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      ...(config.spaceId ? { "X-Space-ID": config.spaceId } : {}),
    },
  });

const withTimeout = async <T>(operation: string, work: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new CleanupTimeoutError(`${operation} timed out after ${CLEANUP_TIMEOUT_MS}ms`)),
          CLEANUP_TIMEOUT_MS,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const cleanupStep = async (
  operation: string,
  work: () => Promise<unknown>,
): Promise<string | null> => {
  let lastError: unknown;
  let attempts = 0;
  for (let attempt = 1; attempt <= CLEANUP_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    try {
      await withTimeout(operation, work());
      return null;
    } catch (error) {
      lastError = error;
      // The published SDK does not expose an AbortSignal for these methods.
      // Its original request may still finish after our deadline, so issuing a
      // retry here would overlap two provider mutations. Continue to the next
      // cleanup phase instead; Stop/Delete are independently attempted and the
      // sandbox's active deadline remains the final backstop.
      if (error instanceof CleanupTimeoutError) break;
    }
  }
  return `${operation} failed after ${attempts} attempt${attempts === 1 ? "" : "s"}: ${lastError instanceof Error ? lastError.message : String(lastError)}`;
};

/**
 * Test reset must remove stopped remote sandboxes too. Clearing only the Map
 * would leave Cloud rows/resources behind and make the next test depend on
 * leaked external state.
 */
export async function __resetSandockRuntimeForTest(): Promise<void> {
  const sandboxes = [...reusableSandboxes.values()].flatMap((bucket) => [...bucket.values()]);
  reusableSandboxes.clear();
  await Promise.all(
    sandboxes.map(async ({ id, config }) => {
      const api = client(config);
      await cleanupStep(`sandbox test reset delete (${id})`, () => api.sandbox.delete(id));
    }),
  );
}

const signedPreviewToken = (previewUrl: string, port: number): string | null => {
  try {
    const label = new URL(previewUrl).hostname.split(".")[0] ?? "";
    const prefix = `${port}-`;
    return label.startsWith(prefix) ? label.slice(prefix.length) || null : null;
  } catch {
    return null;
  }
};

const probePreview = async (
  previewUrl: string,
  signal?: AbortSignal,
): Promise<{ ready: boolean; detail: string }> => {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), PREVIEW_PROBE_TIMEOUT_MS);
  timer.unref?.();

  try {
    const response = await fetch(previewUrl, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    const result = { ready: response.ok, detail: `HTTP ${response.status}` };
    await response.body?.cancel().catch(() => undefined);
    return result;
  } catch (error) {
    return {
      ready: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
};

/** Single-quote for `sh -c`, so a path or command containing quotes can't break out. */
const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

interface ExecutionResultLike {
  stdout?: unknown;
  stderr?: unknown;
  exitCode?: number | null;
  timedOut?: boolean;
}

const formatExecutionOutput = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

const executionFailure = (operation: string, result: ExecutionResultLike): Error => {
  const output = [formatExecutionOutput(result.stdout), formatExecutionOutput(result.stderr)]
    .filter(Boolean)
    .join("\n")
    .trim();
  const status = result.timedOut ? "timed out" : `exit code ${result.exitCode ?? "unknown"}`;
  return new Error(`${operation} failed (${status})${output ? `: ${output}` : ""}`);
};

const assertExecutionSucceeded = (operation: string, result: ExecutionResultLike): void => {
  if (result.exitCode !== 0) throw executionFailure(operation, result);
};

/**
 * Writes one file into the sandbox.
 *
 * Binary goes through base64 + a decode step rather than the `content` string:
 * the write API is text-only, and pushing bytes through it would land the file
 * with the right *name* and corrupted contents — an image that 404s nothing and
 * simply renders broken, which is the worst shape a failure can take.
 */
const writeFile = async (
  api: ReturnType<typeof client>,
  id: string,
  path: string,
  content: string,
  binary: boolean,
): Promise<void> => {
  if (!binary) {
    await api.fs.write(id, `${APP_DIR}/${path}`, content);
    return;
  }
  const staging = `${APP_DIR}/${path}.b64`;
  await api.fs.write(id, staging, content);
  const decoded = await api.sandbox.shell(id, {
    cmd: `mkdir -p ${shellQuote(`${APP_DIR}/${path}`)}/.. && base64 -d ${shellQuote(staging)} > ${shellQuote(`${APP_DIR}/${path}`)} && rm ${shellQuote(staging)}`,
    timeoutMs: 60_000,
  });
  assertExecutionSucceeded(`Binary file decode for ${path}`, decoded.data);
};

export async function* runAirAppSandock(
  input: {
    nodeId: string;
    files: Record<string, string>;
    binaryFiles?: Record<string, string>;
    /** See `local-runtime.ts` — passed in because this runs detached from any request. */
    owner: string;
  },
  signal?: AbortSignal,
): AsyncGenerator<AirAppRuntimeEvent> {
  const config = resolveSandockConfig();
  if (!config) {
    yield {
      type: "error",
      message:
        "The Sandock engine configuration is invalid (set SANDOCK_API_KEY and use an HTTP(S) origin for SANDOCK_BASE_URL).",
    };
    return;
  }

  let plan: RunPlan;
  try {
    plan = resolveRunPlan(input.files);
  } catch (error) {
    yield { type: "error", message: error instanceof Error ? error.message : String(error) };
    return;
  }

  const api = client(config);
  const port = plan.port ?? 3000;
  const installCommand = substitutePort(plan.install, port);
  const startCommand = substitutePort(plan.start, port);
  let sandboxId: string | null = null;
  let previewToken: string | null = null;
  let registeredPreviewUrl: string | null = null;
  let reachedReady = false;

  try {
    yield { type: "log", line: `[busabase] ${plan.explanation}\n` };
    let reusable = readReusableSandbox(input.owner, input.nodeId);
    if (reusable && !hasSameSandboxConfiguration(reusable.config, config)) {
      const staleId = reusable.id;
      dropReusableSandbox(input.owner, input.nodeId, staleId);
      const staleApi = client(reusable.config);
      const deleteError = await cleanupStep("changed-config cached sandbox delete", () =>
        staleApi.sandbox.delete(staleId),
      );
      yield {
        type: "log",
        line: `[busabase] Sandock configuration changed; provisioning a new sandbox${deleteError ? `; old sandbox cleanup warning: ${deleteError}` : ""}.\n`,
      };
      reusable = undefined;
    }
    if (reusable) {
      sandboxId = reusable.id;
      yield { type: "log", line: `[busabase] restarting Sandock sandbox ${sandboxId}…\n` };
      try {
        await api.sandbox.start(sandboxId);
        // Kubernetes Stop deletes the Pod, so Start rebuilds it from the saved
        // sandbox row. A trivial exec proves that rebuilt Pod is actually usable
        // before file transfer begins; start may return before a broken exec path
        // is discovered by the caller.
        const probe = await api.sandbox.shell(sandboxId, {
          cmd: "true",
          timeoutMs: 30_000,
        });
        assertExecutionSucceeded("Restarted sandbox probe", probe.data);
      } catch (error) {
        const staleId = sandboxId;
        dropReusableSandbox(input.owner, input.nodeId, staleId);
        const deleteError = await cleanupStep("unavailable cached sandbox delete", () =>
          api.sandbox.delete(staleId),
        );
        yield {
          type: "log",
          line: `[busabase] cached sandbox ${staleId} is unavailable (${error instanceof Error ? error.message : String(error)}); provisioning a replacement${deleteError ? `; cleanup warning: ${deleteError}` : ""}.\n`,
        };
        sandboxId = null;
      }
    }

    if (!sandboxId) {
      yield { type: "log", line: "[busabase] provisioning a sandbox…\n" };

      // `SandboxCreateOptions.image` is typed as required, but the wire schema
      // (and the server, which falls back to its own configured default image)
      // treat it as optional. JSON serialization drops the undefined field.
      const created = await api.sandbox.create({
        title: `AirApp ${input.nodeId}`,
        image: config.image as string,
        spaceId: config.spaceId,
        cpu: SANDBOX_CPU_MILLICORES,
        memory: SANDBOX_MEMORY_LIMIT_MB,
        command: ["/bin/sh", "-c", "sleep infinity"],
        env: { ...airAppRuntimeEnv("remote"), PORT: String(port) },
        // Sandock measures this from lastStartedAt, so restarting the same ID
        // starts a fresh four-hour provider-side backstop window.
        activeDeadlineSeconds: SANDBOX_DEADLINE_SECONDS,
      });
      sandboxId = created.data.id;
      await api.sandbox.start(sandboxId);
    }
    if (signal?.aborted) return;

    const prepared = await api.sandbox.shell(sandboxId, {
      // A stopped Kubernetes sandbox has a new empty Pod, while another
      // provider may retain its filesystem. Reset the app directory in either
      // case so removed source files cannot survive into the next run.
      cmd: `rm -rf ${shellQuote(APP_DIR)} && mkdir -p ${shellQuote(APP_DIR)}`,
      timeoutMs: 30_000,
    });
    assertExecutionSucceeded("AirApp workspace preparation", prepared.data);
    for (const [path, content] of Object.entries(input.files)) {
      await writeFile(api, sandboxId, path, content, false);
    }
    for (const [path, content] of Object.entries(input.binaryFiles ?? {})) {
      await writeFile(api, sandboxId, path, content, true);
    }
    if (signal?.aborted) return;

    yield { type: "log", line: `$ ${installCommand}\n` };
    const install = await api.sandbox.shell(sandboxId, {
      cmd: installCommand,
      workdir: APP_DIR,
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    const installStdout = formatExecutionOutput(install.data.stdout);
    const installStderr = formatExecutionOutput(install.data.stderr);
    if (installStdout) yield { type: "log", line: installStdout };
    if (installStderr) yield { type: "log", line: installStderr };
    if (install.data.exitCode !== 0) {
      yield {
        type: "error",
        message: executionFailure("Install", install.data).message,
      };
      return;
    }
    if (signal?.aborted) return;
    yield { type: "installed" };

    yield { type: "log", line: `$ ${startCommand}\n` };
    // Detached, because `shell` waits for the command to exit and a dev server
    // does not. `setsid` makes it a session leader so it survives this exec
    // returning, and everything it prints goes to a file we tail below.
    const started = await api.sandbox.shell(sandboxId, {
      cmd: `cd ${shellQuote(APP_DIR)} && rm -f ${shellQuote(APP_LOG)} && setsid sh -c ${shellQuote(`${startCommand} > ${APP_LOG} 2>&1`)} < /dev/null > /dev/null 2>&1 &`,
      workdir: APP_DIR,
      timeoutMs: 60_000,
    });
    const startStdout = formatExecutionOutput(started.data.stdout);
    const startStderr = formatExecutionOutput(started.data.stderr);
    if (startStdout) yield { type: "log", line: startStdout };
    if (startStderr) yield { type: "log", line: startStderr };
    if (started.data.exitCode !== 0) {
      yield {
        type: "error",
        message: executionFailure("Start", started.data).message,
      };
      return;
    }

    const preview = await api.sandbox.getSignedPreviewUrl(sandboxId, {
      port,
      expiresIn: PREVIEW_URL_TTL_SECONDS,
    });
    previewToken = signedPreviewToken(preview.data.url, port);

    // Sandock can issue a signed URL before the detached process has bound its
    // port. Loading the iframe during that window leaves its one request on the
    // Preview Proxy's "No server on pod/port" response even though the app
    // becomes healthy a moment later. Gate `ready` on the same signed Preview
    // hop the iframe will use, and surface startup output while it is pending.
    let offset = 0;
    let lastPreviewDetail = "not probed";
    let consecutivePreviewSuccesses = 0;
    const previewDeadline = Date.now() + PREVIEW_READY_TIMEOUT_MS;
    let previewReady = false;
    while (!signal?.aborted && Date.now() < previewDeadline) {
      const probe = await probePreview(preview.data.url, signal);
      lastPreviewDetail = probe.detail;
      if (probe.ready) {
        consecutivePreviewSuccesses += 1;
        if (consecutivePreviewSuccesses >= PREVIEW_READY_CONSECUTIVE_SUCCESSES) {
          previewReady = true;
          break;
        }
      } else {
        consecutivePreviewSuccesses = 0;
      }

      if (!probe.ready) {
        const tail = await api.sandbox
          .shell(sandboxId, {
            cmd: `tail -c +${offset + 1} ${shellQuote(APP_LOG)} 2>/dev/null || true`,
            timeoutMs: 30_000,
          })
          .catch(() => null);
        const chunk = tail?.data.stdout ?? "";
        if (chunk.length > 0) {
          offset += Buffer.byteLength(chunk, "utf-8");
          yield { type: "log", line: chunk };
        }
      }

      if (!signal?.aborted) {
        await new Promise((resolve) => setTimeout(resolve, LOG_POLL_MS));
      }
    }
    if (signal?.aborted) return;
    if (!previewReady) {
      throw new Error(
        `AirApp did not become reachable through Sandock Preview on port ${port} within ${PREVIEW_READY_TIMEOUT_MS / 1000}s (last probe: ${lastPreviewDetail}). Check the Logs tab for the application startup error.`,
      );
    }

    // Registered as a proxy target, so the app is served from busabase's own
    // origin. That is what keeps a running AirApp's `/api/v1` calls same-origin
    // — the whole reason this engine reuses the local preview path instead of
    // pointing the iframe at `*.sandock.ai` directly.
    await registerLocalPreview(input.nodeId, input.owner, preview.data.url);
    registeredPreviewUrl = preview.data.url.replace(/\/+$/, "");
    reachedReady = true;
    yield { type: "ready", previewUrl: `/api/airapp-preview/${input.nodeId}/` };

    // Tail the app's own output for as long as anyone is running it. Offsets
    // rather than re-reading: a chatty dev server would otherwise replay its
    // whole log on every poll.
    while (!signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, LOG_POLL_MS));
      if (signal?.aborted) break;
      const tail = await api.sandbox
        .shell(sandboxId, {
          cmd: `tail -c +${offset + 1} ${shellQuote(APP_LOG)} 2>/dev/null || true`,
          timeoutMs: 30_000,
        })
        .catch(() => null);
      const chunk = tail?.data.stdout ?? "";
      if (chunk.length > 0) {
        offset += Buffer.byteLength(chunk, "utf-8");
        yield { type: "log", line: chunk };
      }
    }
  } catch (error) {
    if (!signal?.aborted) {
      yield { type: "error", message: error instanceof Error ? error.message : String(error) };
    }
  } finally {
    if (registeredPreviewUrl) {
      await unregisterLocalPreview(input.nodeId, input.owner, registeredPreviewUrl);
    }
    if (sandboxId) {
      const cleanupSandboxId = sandboxId;
      const cleanupPreviewToken = previewToken;
      const cleanupErrors: string[] = [];
      if (cleanupPreviewToken) {
        const revokeError = await cleanupStep("preview token revocation", () =>
          api.sandbox.revokePreviewToken(cleanupSandboxId, cleanupPreviewToken),
        );
        if (revokeError) cleanupErrors.push(revokeError);
      }
      const stopError = await cleanupStep("sandbox stop", () => api.sandbox.stop(cleanupSandboxId));
      if (stopError) cleanupErrors.push(stopError);
      if (reachedReady) {
        if (stopError) {
          // Do not hand an uncertain live sandbox to the next run. The four-hour
          // provider deadline remains the backstop; successful Stop is the only
          // state eligible for reuse.
          dropReusableSandbox(input.owner, input.nodeId, cleanupSandboxId);
        } else {
          putReusableSandbox(input.owner, input.nodeId, {
            id: cleanupSandboxId,
            config,
          });
        }
      } else {
        dropReusableSandbox(input.owner, input.nodeId, cleanupSandboxId);
        // Half-built environments are never cached. Delete is attempted even
        // when Stop failed so failed installs/starts do not accumulate billable
        // or misleading sandboxes.
        const deleteError = await cleanupStep("sandbox delete", () =>
          api.sandbox.delete(cleanupSandboxId),
        );
        if (deleteError) cleanupErrors.push(deleteError);
      }
      if (cleanupErrors.length > 0) {
        yield {
          type: "error",
          message: `Sandock cleanup incomplete for ${cleanupSandboxId}: ${cleanupErrors.join("; ")}`,
        };
      }
    }
  }
}
