export type {
  FileTreeFileVO as AirAppFileVO,
  FileTreeNodeVO as AirAppVO,
  FileTreeReadFileVO as AirAppReadFileVO,
} from "../filetree/types";

/**
 * Where an AirApp's dev server runs. One axis — whose machine executes the
 * code — and nothing else, which is what keeps the three values comparable:
 *
 * - `"browser"` runs the app inside the viewer's own tab, on the
 *   `@scelar/nodepod` Web Worker runtime: a virtual, browser-side filesystem +
 *   process. Nothing is installed and nothing is spawned on any server, so it
 *   is the one engine every deployment can always offer — and the only one
 *   restricted to JavaScript.
 * - `"local"` runs a real `npm install` / `npm run dev` (or the equivalent for
 *   whatever language the app declares) as a bare OS process on the machine
 *   hosting Busabase. Any language, previewable, but **not isolated** — the
 *   trust model is the host's, which is why only the single-user build offers
 *   it.
 * - `"remote"` runs the same lifecycle on a separate machine provisioned per
 *   run (today: a Sandock container). Any language, isolated, and nothing
 *   executes on the Busabase host — at the cost of needing a provider
 *   configured, and of being someone's bill.
 *
 * The value names the location, never the product or the mechanism, so that
 * swapping Nodepod for another in-browser runtime, or Sandock for a different
 * remote provider, is an adapter change and not a wire-format change. Product
 * names stay where the products actually are: `nodepod-runner.ts`,
 * `sandock-runtime.ts`, `SANDOCK_BASE_URL`.
 *
 * `local` and `remote` both stream back to the browser over the
 * `airapps.runLocal` oRPC event iterator; `browser` never calls it. See
 * `busabase-core/domains/airapp/components/runners/`.
 */
export type AirAppRunnerKind = "browser" | "local" | "remote";
