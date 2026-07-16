export type {
  FileTreeFileVO as AirAppFileVO,
  FileTreeNodeVO as AirAppVO,
  FileTreeReadFileVO as AirAppReadFileVO,
} from "../filetree/types";

/**
 * Which engine an AirApp's dev server runs under. `"nodepod"` boots the
 * `@scelar/nodepod` in-browser Web Worker runtime (V1, unchanged). `"local-node"`
 * runs a real `npm install` + `npm run dev` as a server-side OS process (via
 * `@bunny-agent/sdk`'s `LocalSandbox`), streamed back to the browser over the
 * `airapps.runLocalNode` oRPC event iterator — see
 * `busabase-core/domains/airapp/components/runners/local-node-runner.ts`.
 */
export type AirAppRunnerKind = "nodepod" | "local-node";
