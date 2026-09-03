import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import {
  createFileTreeChangeRequestInputSchema,
  createFileTreeInputSchema,
  fileTreeFileOperationInputSchema,
  fileTreeFileSchema,
  fileTreeNodeSchema,
} from "../filetree/contract";
import type { AirAppFileVO, AirAppRunnerKind, AirAppVO } from "./types";

export type { AirAppFileVO, AirAppRunnerKind, AirAppVO };

// AirApps are served by the shared `/file-trees` surface (`type: "airapp"`) —
// see `../filetree/contract`. These aliases stay because callers name the
// schemas after the node type they are working with.
export const airappFileSchema = fileTreeFileSchema;
export const airappSchema = fileTreeNodeSchema;
export const createAirAppInputSchema = createFileTreeInputSchema;
export const airappFileOperationInputSchema = fileTreeFileOperationInputSchema;
export const createAirAppChangeRequestInputSchema = createFileTreeChangeRequestInputSchema;

// --- local runtime (server-side execution engine) -----------------------
// Mirrors the AirAppRunner interface's mount/install/start + onLog/onReady
// semantics as a single streamed operation instead of separate RPCs: the
// server owns the whole `npm install` -> `npm run dev` lifecycle for one
// LocalSandbox process, and the browser-side `LocalRunner` (see
// `busabase-core/domains/airapp/components/runners/local-runner.ts`)
// replays each event into the matching AirAppRunner callback. RPC-only by
// design (no `.route(...)`), same as `live.subscribe` — this is a long-lived
// Event Iterator, not a REST-shaped call.
export const airAppRunLocalInputSchema = z.object({
  nodeId: z.string(),
  /** Text files to mount into the sandbox workdir before installing, keyed by
   *  path (same shape `RunPanel` already assembles for `NodepodRunner.mount`). */
  files: z.record(z.string(), z.string()),
  /** Binary (asset-backed) files — images, fonts, sample data — keyed by the
   *  same path, base64-encoded because this input crosses a JSON boundary that
   *  `Uint8Array` cannot. Separate from `files` rather than a tagged union so
   *  an older client that sends only `files` keeps working unchanged.
   *
   *  The in-browser Nodepod engine never uses this field: it hands raw bytes to
   *  `Nodepod.boot({ files })` directly and skips the base64 round trip. */
  binaryFiles: z.record(z.string(), z.string()).optional().default({}),
  /** Where the server should run it. `"local"` spawns a bare process on the
   *  Busabase host (previewable, data bridge via reverse proxy, NOT isolated);
   *  `"remote"` runs the same lifecycle on a provisioned machine elsewhere.
   *  `"browser"` never reaches this endpoint — it runs entirely in the tab.
   *
   *  Required, deliberately. This used to default to `"local"`, so a call that
   *  simply omitted the field asked the server to spawn a host process — the
   *  most privileged of the two options, reached by saying nothing. Naming the
   *  engine is now the caller's job, and the handler independently refuses one
   *  this deployment does not offer. */
  engine: z.enum(["local", "remote"]),
});

export const airAppRuntimeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("log"), line: z.string() }),
  z.object({ type: z.literal("installed") }),
  z.object({ type: z.literal("ready"), previewUrl: z.string() }),
  z.object({ type: z.literal("exit"), code: z.number().nullable() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type AirAppRuntimeEvent = z.infer<typeof airAppRuntimeEventSchema>;

/**
 * Ending a run is a separate call, because a run outlives the stream that
 * started it. Closing the stream means "this viewer stopped watching", which
 * must not stop anybody's app — so there has to be a way to say the other thing.
 */
export const airAppStopLocalInputSchema = z.object({ nodeId: z.string() });

export const airAppStopLocalOutputSchema = z.object({
  /** `false` when nothing was running — stopping twice is not an error. */
  stopped: z.boolean(),
});

export const airappRuntimeContract = {
  runLocal: oc.input(airAppRunLocalInputSchema).output(eventIterator(airAppRuntimeEventSchema)),
  stopLocal: oc.input(airAppStopLocalInputSchema).output(airAppStopLocalOutputSchema),
};
