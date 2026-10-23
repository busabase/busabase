import type { Nodepod as NodepodInstance, NodepodProcess, RequestProxy } from "@r1ck404/nodepod";
import {
  type RunPlan,
  resolveRunPlan,
  substitutePort,
  tokenizeCommand,
} from "../../utils/airapp-runtime-descriptor";
import { type AirAppHostedRuntime, airAppRuntimeEnv } from "../../utils/airapp-runtime-env";
import { beginPodHeartbeat, ensureRegistered } from "../../utils/nodepod-service-worker";
import {
  dependencyCacheKey,
  dependencyFilesFromSnapshot,
  evictCachedDependencies,
  loadCachedDependencies,
  storeCachedDependencies,
} from "./dependency-cache";
import type { AirAppMountedFile, AirAppRunner } from "./types";

/**
 * Same-origin paths that belong to the Busabase host and must never be served
 * by a pod. Handed to Nodepod's official `reservedHostPaths` boot option
 * (`NodepodOptions.reservedHostPaths`, added upstream in 1.10.x, unchanged in
 * 1.11.2) so the host no longer needs hand-written guards in the Service
 * Worker for them.
 *
 * A running pod claims a broad path — usually `/` — so without this
 * declaration a live (or stale, post-teardown) claim captures these host
 * routes. Upstream honours a reserved path in two directions: the path itself
 * is never routed to a pod, and requests issued by a document *at* a reserved
 * path bypass pod routing as well.
 *
 * Entries ending in `/` are prefix matches, the rest are exact — so a route
 * that needs both forms is deliberately listed twice.
 *
 * - `/api/airapp-embed-bridge/` — the AirApp Embed runtime's own
 *   capability-scoped relay. Always fetched by the trusted parent/host page
 *   (its postMessage bridge and its `_status` heartbeat), never from inside a
 *   pod, and it re-authorizes from a capability header rather than a cookie.
 * - `/api/airapp-preview` + `/api/airapp-preview/` — Busabase's authenticated
 *   reverse proxy in front of Sandock. A stopped pod's leftover `/` claim
 *   would otherwise capture the next Sandock iframe navigation.
 * - `/embed/` — the public AirApp Embed host document, its frame navigations
 *   and its subresources (its `_next` chunks and fonts).
 *
 * DELIBERATELY ABSENT: `/api/v1`. Busabase's public REST surface is handled
 * end-to-end by the `[busabase patch]` guard in
 * `patches/@r1ck404__nodepod@1.11.2.patch`, which does something
 * `reservedHostPaths` cannot — it answers **403** while an embed pod is alive,
 * so a request that bypassed the embed runtime's injected fetch override (a
 * raw `XMLHttpRequest`, say) can never reach the backend carrying the viewer's
 * session. Only when no embed pod is involved does it fall through to the same
 * plain host bypass a reserved path would have produced.
 *
 * That guard has to run BEFORE upstream's `isReservedHostPath` early exits, so
 * listing `/api/v1` here would be dead config: the early exit would return
 * first and the 403 would never fire. Worse, it would make the patch look
 * redundant to whoever does the next upgrade — and deleting it silently
 * removes a session-leak defence. Leave `/api/v1` out.
 */
export const NODEPOD_RESERVED_HOST_PATHS: readonly string[] = [
  "/api/airapp-embed-bridge/",
  "/api/airapp-preview",
  "/api/airapp-preview/",
  "/embed/",
];

/**
 * `AirAppRunner` implementation backed by the `@r1ck404/nodepod` in-browser
 * Node.js runtime (github.com/R1ck404/Nodepod, published to npm as
 * `@r1ck404/nodepod` since 1.11.1; earlier releases were `@scelar/nodepod`,
 * now deprecated). Only ever loaded via a dynamic `import()` inside these
 * methods — never as a static top-level import — so the runtime's Web
 * Worker/Service Worker bundle is code-split out of the main dashboard bundle
 * and only downloads when a user actually clicks "Run".
 *
 * Nodepod's real SDK shape (verified against the published package's README +
 * source, not assumed): `Nodepod.boot({ files, onServerReady })` creates the
 * runtime AND mounts the initial files in one call — there's no separate
 * "create empty runtime, then write files" step — `nodepod.spawn(cmd, args)`
 * runs a command and resolves once it's *running* (not once it exits — a dev
 * server never exits on its own), and `nodepod.port(num)` resolves a
 * same-origin preview URL for a port this instance is listening on (null for
 * other instances' ports). Teardown is `nodepod.teardown()`, not a
 * `dispose()` method.
 * `AirAppRunner`'s `mount/install/start/onLog/onReady/dispose` shape is our
 * own adapter over that surface, kept stable so a future WebContainer-based
 * runner can implement the same interface.
 */
export class NodepodRunner implements AirAppRunner {
  private static readonly START_READY_TIMEOUT_MS = 60_000;

  private nodepod: NodepodInstance | null = null;
  private installProcess: NodepodProcess | null = null;
  private devProcess: NodepodProcess | null = null;
  private logCallbacks: Array<(line: string) => void> = [];
  private readyCallbacks: Array<(previewPath: string) => void> = [];
  private exitCallbacks: Array<(code: number | null) => void> = [];
  private lastReadyUrl: string | null = null;
  private proxy: RequestProxy | null = null;
  private proxyListener: ((port: number, url: string) => void) | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private stopHeartbeat: (() => void) | null = null;
  /**
   * Resolved in `mount()` from the app's own files, by the same isomorphic
   * resolver the server-side engines use. Nodepod runs entirely in the browser,
   * so there is no round trip to ask what to execute — which is precisely why
   * that resolver may not import anything server-side.
   */
  private plan: RunPlan | null = null;
  /** See `./dependency-cache.ts`. Null when this run's install is not cacheable. */
  private dependencyKey: string | null = null;
  /** How many `node_modules` files `mount()` restored from the cache, if any. */
  private restoredDependencyFiles: number | null = null;

  /**
   * `runtimeKind` is what the running app sees in `BUSABASE_AIRAPP_RUNTIME` —
   * the same in-browser engine backs both the dashboard preview (`"browser"`)
   * and the public embed (`"embed"`), and an app may legitimately behave
   * differently in the two (the embed relays `/api/v1` through a
   * capability-scoped, read-only route rather than the viewer's session).
   */
  constructor(
    private readonly previewScript?: string,
    private readonly runtimeKind: AirAppHostedRuntime = "browser",
  ) {}

  private requirePlan(): RunPlan {
    if (!this.plan) {
      throw new Error("NodepodRunner: mount() must be called before install()/start()");
    }
    return this.plan;
  }

  private emitLog(line: string): void {
    for (const cb of this.logCallbacks) {
      cb(line);
    }
  }

  private emitReady(previewPath: string): void {
    this.lastReadyUrl = previewPath;
    for (const cb of this.readyCallbacks) {
      cb(previewPath);
    }
  }

  private scheduleReady(previewPath: string): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    const nodepod = this.nodepod;
    this.readyTimer = setTimeout(() => {
      this.readyTimer = null;
      if (this.nodepod === nodepod) this.emitReady(previewPath);
    }, 100);
  }

  private recoverReadyFromActivePorts(): void {
    const nodepod = this.nodepod;
    if (!nodepod || this.lastReadyUrl) return;

    for (const port of nodepod.proxy.activePorts(nodepod.instanceId)) {
      const url = nodepod.port(port);
      if (url) {
        this.scheduleReady(url);
        return;
      }
    }
  }

  private async waitForReadyOrExit(proc: NodepodProcess): Promise<void> {
    if (this.lastReadyUrl) return;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.readyCallbacks = this.readyCallbacks.filter((callback) => callback !== onReady);
        if (error) reject(error);
        else resolve();
      };
      const onReady = () => finish();
      const timeout = setTimeout(
        () => finish(new Error("Dev server did not expose a preview port within 60 seconds")),
        NodepodRunner.START_READY_TIMEOUT_MS,
      );

      this.readyCallbacks.push(onReady);
      if (this.lastReadyUrl) {
        finish();
        return;
      }

      void proc.completion.then(({ exitCode, stderr }) => {
        if (this.lastReadyUrl) {
          finish();
          return;
        }
        const detail = stderr.trim().slice(-500);
        finish(
          new Error(
            `Dev server exited with code ${exitCode} before opening a preview port${detail ? `: ${detail}` : ""}`,
          ),
        );
      });
    });
  }

  // `Nodepod.boot({ files })` is typed `Record<string, string | Uint8Array>`
  // upstream, so binary entries need no encoding hop here — they go straight
  // into the pod's virtual filesystem as bytes.
  async mount(files: Record<string, AirAppMountedFile>): Promise<void> {
    // Only text files can carry a manifest; binary entries are passed through
    // untouched. Nodepod is a browser-side JavaScript runtime, so a plan it
    // cannot execute is caught by engine eligibility before a run ever starts
    // (see `resolveEngine` in the descriptor module) — this resolve is about
    // *which commands*, not which language.
    const textFiles: Record<string, string> = {};
    for (const [filePath, content] of Object.entries(files)) {
      if (typeof content === "string") textFiles[filePath] = content;
    }
    this.plan = resolveRunPlan(textFiles);

    // A cached `node_modules` for exactly this manifest is mounted alongside
    // the app's files, and `install()` then has nothing to do. The app's own
    // files win any path clash: they were just read from the server.
    this.dependencyKey = await dependencyCacheKey(files, this.plan);
    this.restoredDependencyFiles = null;
    const cachedDependencies = this.dependencyKey
      ? await loadCachedDependencies(this.dependencyKey)
      : null;
    let bootFiles = files;
    if (cachedDependencies) {
      bootFiles = { ...cachedDependencies, ...files };
      this.restoredDependencyFiles = Object.keys(cachedDependencies).length;
    }

    const { Nodepod } = await import("@r1ck404/nodepod");
    // Nodepod's own SW registration lives behind a page-lifetime `swReady`
    // flag on its RequestProxy singleton, so it is skipped entirely if the
    // page already booted a pod once. A marketing-route visit in between may
    // have released the registration (see utils/nodepod-service-worker.ts) —
    // put it back before booting, and mark the pod alive so no other tab
    // releases it from under this run.
    await ensureRegistered();
    this.stopHeartbeat?.();
    this.stopHeartbeat = beginPodHeartbeat();
    this.nodepod = await Nodepod.boot({
      files: bootFiles,
      // Pod-level env (used by Nodepod's terminal shell). The dev server gets
      // it via `spawn`'s own options below — verified against the published
      // bundle, whose `spawn()` passes `opts.env` straight through and does
      // NOT merge the boot env into spawned processes.
      env: airAppRuntimeEnv(this.runtimeKind),
      watermark: false,
      // Host routes a pod must never serve — see NODEPOD_RESERVED_HOST_PATHS
      // above for the full list and for why `/api/v1` is deliberately not in
      // it. Spread because upstream types the option as a mutable `string[]`.
      reservedHostPaths: [...NODEPOD_RESERVED_HOST_PATHS],
      // Start fetching + compiling esbuild-wasm (~10MB) during boot so it
      // overlaps the npm install instead of stalling the first build step.
      preloadEsbuild: true,
      // Always serve the preview at `/__virtual__/{pod}/{port}` on the host
      // origin. Upstream's default ("auto", new in 1.10.x and still the
      // default in 1.11.2) tries a per-pod origin (`{pod}-{port}.localhost`)
      // first whenever the page is on localhost — Desktop, OSS self-host,
      // local dev — by loading
      // `/__nodepod_bridge__.html` there. We do not serve that document, so the
      // bridge timed out after 10s and only then fell back to this same path
      // URL: every start on localhost waited 10s after the app was already
      // listening. Cloud never paid it (not a loopback hostname). A per-pod
      // origin would also break the app's same-origin `/api/v1` calls.
      previewOrigin: false,
    });
    if (this.previewScript) {
      await this.nodepod.setPreviewScript(this.previewScript);
    }
    // Deliberately NOT using boot's `onServerReady`. The original reason:
    // Nodepod's RequestProxy is a page-lifetime singleton, and it kept only the
    // FIRST boot's callback — every later boot's callback was silently
    // dropped, so after the first runner was disposed (e.g. on re-run) no
    // runner heard "server ready" again and the run stayed stuck at "starting"
    // with no preview. 1.10.1 and 1.11.2 also store the callback per instance
    // (boot() → `configureInstance`, which `_emitServerReady` prefers), so that
    // exact failure no longer follows from the bundle — but subscribing to the
    // singleton's event stream works for every boot on every version, so it
    // stays. `port()` is scoped to this instance's id, so events from other
    // AirApp nodes running on the same page resolve to null and are ignored.
    this.proxy = this.nodepod.proxy;
    // Explicit re-assertion, redundant with the `watermark: false` boot option
    // above. On Nodepod 1.9.20 (then published as `@scelar/nodepod`) that
    // option alone stopped reliably suppressing the SW-injected branding badge
    // (confirmed at the time via tests/e2e/airapp.spec.ts's watermark
    // regression check) — this calls the same public RequestProxy API
    // nodepod's own boot() already calls, as a defensive backstop against
    // whatever timing changed upstream. Safe no-op if boot() already got it
    // right.
    //
    // Re-checked statically on the 1.11.2 upgrade (unchanged from 1.10.1):
    //   * boot() forwards the option the same way 1.9.20 did. The guard is
    //     the same expression: `(headless && watermark !== true ||
    //     watermark === false) && proxy.setWatermark(false)`. It runs right
    //     after `configureInstance()` (not inside it) and before boot's own
    //     `initServiceWorker()` handshake.
    //   * `setWatermark()` posts straight to
    //     `navigator.serviceWorker.controller` (plus any preview bridges) with
    //     no pending queue, so that one message is dropped if the page is not
    //     controlled yet. The SW's `set-watermark` handler needs no token.
    //   * RequestProxy does keep the flag (`_watermarkEnabled`) and re-sends it
    //     from its `controllerchange` / `sw-needs-init` re-init handler, so a
    //     dropped message is normally repaired once the SW takes control.
    //   * Busabase's `ensureRegistered()` waits for a controller before
    //     `Nodepod.boot()`, so in this flow boot's own call normally lands.
    // So this line is belt-and-braces rather than the only delivery that
    // works. The 1.9.20 regression was never pinned to a cause, so keep it:
    // one idempotent call that cannot regress anything.
    //
    // Last verified for real on 1.10.1: tests/e2e/airapp.spec.ts's watermark
    // regression check (`toHaveCount(0)` on the Nodepod GitHub badge anchor)
    // passed in a real browser, against a real dev-server pod.
    this.proxy.setWatermark(false);
    this.proxyListener = (port: number) => {
      const url = this.nodepod?.port(port);
      if (url) {
        this.scheduleReady(url);
      }
    };
    this.proxy.on("server-ready", this.proxyListener);
  }

  async install(): Promise<void> {
    const nodepod = this.nodepod;
    if (!nodepod) {
      throw new Error("NodepodRunner: mount() must be called before install()");
    }
    const plan = this.requirePlan();
    this.emitLog(`[busabase] ${plan.explanation}\n`);
    if (this.restoredDependencyFiles !== null) {
      this.emitLog(
        `[busabase] Restored ${this.restoredDependencyFiles} dependency files from this device's cache; skipped \`${plan.install}\`.\n`,
      );
      return;
    }
    const argv = tokenizeCommand(plan.install);
    this.emitLog(`$ ${plan.install}\n`);
    const proc = await nodepod.spawn(argv[0], argv.slice(1));
    this.installProcess = proc;
    proc.on("output", (chunk: string) => this.emitLog(chunk));
    proc.on("error", (chunk: string) => this.emitLog(chunk));
    const { exitCode } = await proc.completion;
    if (exitCode !== 0) {
      throw new Error(`${plan.install} exited with code ${exitCode}`);
    }
    this.cacheInstalledDependencies(nodepod);
  }

  /**
   * Stores the tree the install just wrote. Taken before the dev server runs,
   * so nothing it writes into `node_modules` at runtime is captured. The write
   * itself is not awaited: a failed or slow cache write must never hold up or
   * fail the run.
   */
  private cacheInstalledDependencies(nodepod: NodepodInstance): void {
    const key = this.dependencyKey;
    if (!key) return;
    let files: ReturnType<typeof dependencyFilesFromSnapshot> = null;
    try {
      files = dependencyFilesFromSnapshot(nodepod.snapshot({ shallow: false }));
    } catch {
      return;
    }
    if (files) void storeCachedDependencies(key, files).catch(() => {});
  }

  async start(): Promise<void> {
    const nodepod = this.nodepod;
    if (!nodepod) {
      throw new Error("NodepodRunner: mount() must be called before start()");
    }
    const plan = this.requirePlan();
    // Nodepod serves the pod's own port through its Service Worker, so there is
    // no host port to allocate; the app's declared port (or Node's habitual
    // 3000) is the only number a `$PORT` placeholder could mean here.
    const startCommand = substitutePort(plan.start, plan.port ?? 3000);
    const startArgv = tokenizeCommand(startCommand);
    this.emitLog(`$ ${startCommand}\n`);
    // This env is the app's only trustworthy answer to "am I Busabase-hosted?"
    // — see `utils/airapp-runtime-env.ts` for why hostname sniffing can't be.
    const proc = await nodepod.spawn(startArgv[0], startArgv.slice(1), {
      env: airAppRuntimeEnv(this.runtimeKind),
    });
    this.devProcess = proc;
    proc.on("output", (chunk: string) => this.emitLog(chunk));
    proc.on("error", (chunk: string) => this.emitLog(chunk));
    proc.on("exit", (code: number) => {
      this.emitLog(`\n[dev server exited with code ${code}]\n`);
      for (const cb of this.exitCallbacks) cb(code);
    });
    // The process can bind its port before spawn() resolves. Normally the
    // proxy event above catches that, but controller changes during an AirApp
    // restart can drop the one-shot notification. The registry is the source
    // of truth, so recover an already-listening port instead of retaining a
    // preview URL for a pod that was already torn down.
    this.recoverReadyFromActivePorts();
    try {
      await this.waitForReadyOrExit(proc);
    } catch (error) {
      // A cached tree that no longer starts must not pin the app in a broken
      // state run after run: drop it, so the next run installs from scratch.
      if (this.restoredDependencyFiles !== null && this.dependencyKey) {
        this.emitLog(
          "[busabase] The app failed to start from cached dependencies; they were cleared and the next run reinstalls them.\n",
        );
        void evictCachedDependencies(this.dependencyKey).catch(() => {});
      }
      throw error;
    }
  }

  onLog(cb: (line: string) => void): void {
    this.logCallbacks.push(cb);
  }

  onExit(cb: (code: number | null) => void): void {
    this.exitCallbacks.push(cb);
  }

  /** In-browser, so stopping and disposing are the same teardown. */
  async stop(): Promise<void> {
    this.dispose();
  }

  onReady(cb: (previewPath: string) => void): void {
    this.readyCallbacks.push(cb);
    if (this.lastReadyUrl) {
      cb(this.lastReadyUrl);
    }
  }

  dispose(): void {
    this.stopHeartbeat?.();
    this.stopHeartbeat = null;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    if (this.proxy && this.proxyListener) {
      this.proxy.off("server-ready", this.proxyListener);
    }
    this.proxy = null;
    this.proxyListener = null;
    this.devProcess?.kill();
    this.installProcess?.kill();
    this.nodepod?.teardown();
    this.nodepod = null;
    this.devProcess = null;
    this.installProcess = null;
    this.logCallbacks = [];
    this.readyCallbacks = [];
  }
}
