import "server-only";

import type { AirAppRuntimeEvent } from "busabase-contract/domains/airapp/contract";
import { createSandboxOpenApiClient } from "sandock-contract/api-client";
import { type RunPlan, resolveRunPlan, substitutePort } from "../utils/airapp-runtime-descriptor";
import { airAppRuntimeEnv } from "../utils/airapp-runtime-env";
import { registerLocalPreview, unregisterLocalPreview } from "./local-preview-registry";

/**
 * The Sandock engine: an AirApp running in a remote container instead of on the
 * host.
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

const PREVIEW_URL_TTL_SECONDS = 3600;

export interface SandockConfig {
  baseUrl: string;
  apiKey: string;
  image?: string;
}

/**
 * Sandock is available when it is *configured*, not when the deployment happens
 * to be the cloud one. A self-hoster who would rather not run app processes on
 * their own box can point at a Sandock and get the same engine.
 */
export function resolveSandockConfig(env: NodeJS.ProcessEnv = process.env): SandockConfig | null {
  const baseUrl = env.SANDOCK_BASE_URL?.trim();
  const apiKey = env.SANDOCK_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, image: env.SANDOCK_IMAGE?.trim() || undefined };
}

/**
 * The base URL is the server's origin, with **no** `/api/v1` appended: the
 * contract already carries that prefix (`oc.prefix("/api/v1")`), so adding it
 * here produced `/api/v1/api/v1/sandbox` and a flat `Not Found` that named
 * nothing. Found by running against a real Sandock — the recording stand-in in
 * the unit tests never sees a URL, so it could not have caught this.
 */
const client = (config: SandockConfig) =>
  createSandboxOpenApiClient({
    baseUrl: config.baseUrl.replace(/\/+$/, ""),
    headers: { authorization: `Bearer ${config.apiKey}` },
  });

/** Single-quote for `sh -c`, so a path or command containing quotes can't break out. */
const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

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
    await api.writeFile({ id, path: `${APP_DIR}/${path}`, content });
    return;
  }
  const staging = `${APP_DIR}/${path}.b64`;
  await api.writeFile({ id, path: staging, content });
  await api.shell({
    id,
    cmd: `mkdir -p ${shellQuote(`${APP_DIR}/${path}`)}/.. && base64 -d ${shellQuote(staging)} > ${shellQuote(`${APP_DIR}/${path}`)} && rm ${shellQuote(staging)}`,
    timeoutMs: 60_000,
  });
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
        "The Sandock engine is not configured on this deployment (set SANDOCK_BASE_URL and SANDOCK_API_KEY).",
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

  try {
    yield { type: "log", line: `[busabase] ${plan.explanation}\n` };
    yield { type: "log", line: "[busabase] provisioning a sandbox…\n" };

    const created = await api.create({
      title: `AirApp ${input.nodeId}`,
      ...(config.image ? { image: config.image } : {}),
      // A container that stays up while we exec into it — the same shape buda
      // uses. Without this the sandbox would exit as soon as its entrypoint did.
      command: ["/bin/sh", "-c", "sleep infinity"],
      env: { ...airAppRuntimeEnv("sandock"), PORT: String(port) },
      activeDeadlineSeconds: SANDBOX_DEADLINE_SECONDS,
    });
    sandboxId = created.data.id;
    await api.start({ id: sandboxId });
    if (signal?.aborted) return;

    await api.shell({ id: sandboxId, cmd: `mkdir -p ${shellQuote(APP_DIR)}`, timeoutMs: 30_000 });
    for (const [path, content] of Object.entries(input.files)) {
      await writeFile(api, sandboxId, path, content, false);
    }
    for (const [path, content] of Object.entries(input.binaryFiles ?? {})) {
      await writeFile(api, sandboxId, path, content, true);
    }
    if (signal?.aborted) return;

    yield { type: "log", line: `$ ${installCommand}\n` };
    const install = await api.shell({
      id: sandboxId,
      cmd: installCommand,
      workdir: APP_DIR,
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    if (install.data.stdout) yield { type: "log", line: install.data.stdout };
    if (install.data.stderr) yield { type: "log", line: install.data.stderr };
    if (install.data.exitCode !== 0) {
      yield {
        type: "error",
        message: `Install failed (exit code ${install.data.exitCode ?? "unknown"}).`,
      };
      return;
    }
    if (signal?.aborted) return;
    yield { type: "installed" };

    yield { type: "log", line: `$ ${startCommand}\n` };
    // Detached, because `shell` waits for the command to exit and a dev server
    // does not. `setsid` makes it a session leader so it survives this exec
    // returning, and everything it prints goes to a file we tail below.
    await api.shell({
      id: sandboxId,
      cmd: `cd ${shellQuote(APP_DIR)} && rm -f ${shellQuote(APP_LOG)} && setsid sh -c ${shellQuote(`${startCommand} > ${APP_LOG} 2>&1`)} < /dev/null > /dev/null 2>&1 &`,
      workdir: APP_DIR,
      timeoutMs: 60_000,
    });

    const preview = await api.signedPreviewUrl({
      id: sandboxId,
      port,
      expiresIn: PREVIEW_URL_TTL_SECONDS,
    });
    // Registered as a proxy target, so the app is served from busabase's own
    // origin. That is what keeps a running AirApp's `/api/v1` calls same-origin
    // — the whole reason this engine reuses the local preview path instead of
    // pointing the iframe at `*.sandock.ai` directly.
    registerLocalPreview(input.nodeId, input.owner, preview.data.url);
    yield { type: "ready", previewUrl: `/api/airapp-preview/${input.nodeId}/` };

    // Tail the app's own output for as long as anyone is running it. Offsets
    // rather than re-reading: a chatty dev server would otherwise replay its
    // whole log on every poll.
    let offset = 0;
    while (!signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, LOG_POLL_MS));
      if (signal?.aborted) break;
      const tail = await api
        .shell({
          id: sandboxId,
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
    unregisterLocalPreview(input.nodeId, input.owner);
    if (sandboxId) {
      // Best-effort, and deliberately not awaited into the caller's error path:
      // a sandbox we failed to delete is still on Sandock's own deadline, so the
      // worst case is bounded rather than permanent.
      await api.stop({ id: sandboxId }).catch(() => undefined);
      await api.delete({ id: sandboxId }).catch(() => undefined);
    }
  }
}
