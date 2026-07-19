export type {
  FileTreeFileVO as AirAppFileVO,
  FileTreeNodeVO as AirAppVO,
  FileTreeReadFileVO as AirAppReadFileVO,
} from "../filetree/types";

/**
 * Which engine an AirApp's dev server runs under.
 *
 * - `"nodepod"` boots the `@scelar/nodepod` in-browser Web Worker runtime (V1,
 *   unchanged) — a virtual, browser-side filesystem + process.
 * - `"local-node"` runs a real `npm install` + `npm run dev` as a **bare**
 *   server-side OS process (NOT OS-isolated — trust model is the local host).
 *   Its listening port IS reachable from the host, so the same-origin reverse
 *   proxy preview (`/api/airapp-preview/{nodeId}/`) and the
 *   `/__busabase_api__/` data bridge both work.
 * - `"srt"` runs the same `npm install` + `npm run dev` lifecycle wrapped in
 *   `@anthropic-ai/sandbox-runtime`'s `SandboxManager` for real OS-level
 *   isolation (seccomp/bubblewrap on Linux, `sandbox-exec` on macOS). Isolated
 *   execution + logs work, but live web preview is UNAVAILABLE: srt
 *   network-isolates the process, so its app port is not reachable from the
 *   host reverse proxy.
 *
 * All three stream back to the browser over the `airapps.runLocalNode` oRPC
 * event iterator — see
 * `busabase-core/domains/airapp/components/runners/local-node-runner.ts`
 * (which backs both `local-node` and `srt`, differing only in the server-side
 * execution mode).
 */
export type AirAppRunnerKind = "nodepod" | "local-node" | "srt";
