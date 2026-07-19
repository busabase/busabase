import type { Nodepod as NodepodInstance, NodepodProcess, RequestProxy } from "@scelar/nodepod";
import type { AirAppRunner } from "./types";

/**
 * `AirAppRunner` implementation backed by the `@scelar/nodepod` in-browser
 * Node.js runtime (github.com/R1ck404/Nodepod, published to npm as
 * `@scelar/nodepod`). Only ever loaded via a dynamic `import()` inside these
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
  private nodepod: NodepodInstance | null = null;
  private installProcess: NodepodProcess | null = null;
  private devProcess: NodepodProcess | null = null;
  private logCallbacks: Array<(line: string) => void> = [];
  private readyCallbacks: Array<(previewPath: string) => void> = [];
  private lastReadyUrl: string | null = null;
  private proxy: RequestProxy | null = null;
  private proxyListener: ((port: number, url: string) => void) | null = null;

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

  async mount(files: Record<string, string>): Promise<void> {
    const { Nodepod, getProxyInstance } = await import("@scelar/nodepod");
    this.nodepod = await Nodepod.boot({
      files,
      watermark: false,
      // Start fetching + compiling esbuild-wasm (~10MB) during boot so it
      // overlaps the npm install instead of stalling the first build step.
      preloadEsbuild: true,
    });
    // Deliberately NOT using boot's `onServerReady`: Nodepod's RequestProxy is
    // a page-lifetime singleton that captures only the FIRST boot's callback —
    // every later boot's callback is silently dropped. After the first runner
    // is disposed (e.g. on re-run), no runner would ever hear "server ready"
    // again and the run stays stuck at "starting" with no preview. Subscribing
    // to the singleton's event stream instead works for every boot; `port()`
    // is scoped to this instance's id, so events from other AirApp nodes
    // running on the same page resolve to null and are ignored.
    this.proxy = getProxyInstance();
    this.proxyListener = (port: number) => {
      const url = this.nodepod?.port(port);
      if (url) {
        this.emitReady(url);
      }
    };
    this.proxy.on("server-ready", this.proxyListener);
  }

  async install(): Promise<void> {
    const nodepod = this.nodepod;
    if (!nodepod) {
      throw new Error("NodepodRunner: mount() must be called before install()");
    }
    this.emitLog("$ npm install\n");
    const proc = await nodepod.spawn("npm", ["install"]);
    this.installProcess = proc;
    proc.on("output", (chunk: string) => this.emitLog(chunk));
    proc.on("error", (chunk: string) => this.emitLog(chunk));
    const { exitCode } = await proc.completion;
    if (exitCode !== 0) {
      throw new Error(`npm install exited with code ${exitCode}`);
    }
  }

  async start(): Promise<void> {
    const nodepod = this.nodepod;
    if (!nodepod) {
      throw new Error("NodepodRunner: mount() must be called before start()");
    }
    this.emitLog("$ npm run dev\n");
    const proc = await nodepod.spawn("npm", ["run", "dev"]);
    this.devProcess = proc;
    proc.on("output", (chunk: string) => this.emitLog(chunk));
    proc.on("error", (chunk: string) => this.emitLog(chunk));
    proc.on("exit", (code: number) => this.emitLog(`\n[dev server exited with code ${code}]\n`));
  }

  onLog(cb: (line: string) => void): void {
    this.logCallbacks.push(cb);
  }

  onReady(cb: (previewPath: string) => void): void {
    this.readyCallbacks.push(cb);
    if (this.lastReadyUrl) {
      cb(this.lastReadyUrl);
    }
  }

  dispose(): void {
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
