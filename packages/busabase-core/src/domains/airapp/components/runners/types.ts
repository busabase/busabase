/**
 * Which engine an `AirAppRunner` is backed by, surfaced in the UI's engine
 * setting (see `NodeSettingsDialog`'s General tab) and persisted per-node in
 * `airapp-runner-store.ts` so switching tabs/nodes remembers the user's last
 * choice. Re-exported from `busabase-contract` (the type is shared with the
 * server-side `runLocal` oRPC contract) — kept here too as the
 * UI-facing name callers of this file already import from.
 */
export type { AirAppRunnerKind } from "busabase-contract/domains/airapp/contract";

/**
 * Engine-agnostic contract for "run this AirApp's files and show me a
 * preview". Two implementations ship: `nodepod-runner.ts` (in-browser,
 * backed by the `@scelar/nodepod` Web Worker runtime) and
 * `local-runner.ts` (server-side, a real `npm install` + `npm run dev`
 * OS process via the `airapps.runLocal` oRPC endpoint). This interface
 * is kept intentionally narrow and transport-agnostic so a third engine
 * (e.g. a future WebContainer-based one) can implement it later without
 * touching `RunPanel` — see the airapp changelog's Follow-up Tasks for why
 * WebContainer isn't in V1 (busabase's API keys are account-scoped, unsafe
 * to inject into a cross-origin WebContainer sandbox until a scoped-key
 * system exists).
 */
/**
 * One mounted file's contents: a UTF-8 string for text, or raw bytes for a
 * binary (asset-backed) file such as an image, font, or sample dataset.
 *
 * Binary was skipped entirely in V1, which made an AirApp that shipped its own
 * images fail in the worst possible way: the file stored fine, the pod booted
 * fine, and the `<img>` just 404'd against the dev server with nothing logged.
 * Nodepod itself never had this limit — its public `boot({ files })` option is
 * typed `Record<string, string | Uint8Array>` and `NodepodFS.writeFile` takes
 * `string | Uint8Array` — so this is busabase catching up to the runtime, not
 * working around it.
 */
export type AirAppMountedFile = string | Uint8Array;

export interface AirAppRunner {
  /** Write the initial file set into the runner's virtual filesystem. */
  mount(files: Record<string, AirAppMountedFile>): Promise<void>;
  /** Install the project's declared dependencies (e.g. `npm install`). */
  install(): Promise<void>;
  /** Start the dev server (e.g. `npm run dev`). Resolves once the process has
   *  been launched — NOT once it exits (a dev server runs indefinitely). Use
   *  `onReady` to know when the preview is actually servable. */
  start(): Promise<void>;
  /** Subscribe to combined stdout/stderr lines from install + start. */
  onLog(cb: (line: string) => void): void;
  /** Subscribe to "the dev server is listening" events. Fires with a same-origin
   *  preview URL/path suitable for an `<iframe src>`. May fire more than once
   *  (e.g. a restart) — the caller should just re-point the iframe each time. */
  onReady(cb: (previewPath: string) => void): void;
  /** Subscribe to "the app's process ended".
   *
   *  Distinct from `dispose()`: this fires when the *app* stopped on its own,
   *  which the UI must show. Without it, a dev server that crashed after
   *  install emitted one log line and nothing else, so the panel went on
   *  reporting success over a preview that had been dead for minutes. */
  onExit(cb: (code: number | null) => void): void;
  /** End the run for real: kill the process / destroy the sandbox.
   *
   *  Separate from `dispose()` because a run now outlives the view that
   *  started it. Disposing means "this surface is going away"; stopping means
   *  "the app should not be running any more", and only the second one is the
   *  user's decision. */
  stop(): Promise<void>;
  /** Tear down this client-side handle. Does NOT stop a server-side run. */
  dispose(): void;
}
