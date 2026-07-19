import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import {
  createFileTreeChangeRequestInputSchema,
  createFileTreeInputSchema,
  fileTreeFileOperationInputSchema,
  fileTreeFileSchema,
  fileTreeNodeSchema,
  makeFileTreeContract,
} from "../filetree/contract";
import type { AirAppFileVO, AirAppRunnerKind, AirAppVO } from "./types";

export type { AirAppFileVO, AirAppRunnerKind, AirAppVO };

export const airappFileSchema = fileTreeFileSchema;
export const airappSchema = fileTreeNodeSchema;
export const createAirAppInputSchema = createFileTreeInputSchema;
export const airappFileOperationInputSchema = fileTreeFileOperationInputSchema;
export const createAirAppChangeRequestInputSchema = createFileTreeChangeRequestInputSchema;

export const airappContract = makeFileTreeContract("airapps", "AirApps");

// --- local-node runtime (server-side execution engine) -----------------------
// Mirrors the AirAppRunner interface's mount/install/start + onLog/onReady
// semantics as a single streamed operation instead of separate RPCs: the
// server owns the whole `npm install` -> `npm run dev` lifecycle for one
// LocalSandbox process, and the browser-side `LocalNodeRunner` (see
// `busabase-core/domains/airapp/components/runners/local-node-runner.ts`)
// replays each event into the matching AirAppRunner callback. RPC-only by
// design (no `.route(...)`), same as `live.subscribe` — this is a long-lived
// Event Iterator, not a REST-shaped call.
export const airAppRunLocalNodeInputSchema = z.object({
  nodeId: z.string(),
  /** Text files to mount into the sandbox workdir before installing, keyed by
   *  path (same shape `RunPanel` already assembles for `NodepodRunner.mount`). */
  files: z.record(z.string(), z.string()),
  /** Server-side execution mode. `"local-node"` spawns a bare host Node.js
   *  process (previewable, data bridge via reverse proxy, NOT OS-isolated);
   *  `"srt"` wraps the same commands in the OS sandbox (isolated execution,
   *  but live preview is unreachable). `"nodepod"` never calls this endpoint —
   *  it runs entirely in-browser. */
  engine: z.enum(["local-node", "srt"]).default("local-node"),
});

export const airAppRuntimeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("log"), line: z.string() }),
  z.object({ type: z.literal("installed") }),
  z.object({ type: z.literal("ready"), previewUrl: z.string() }),
  z.object({ type: z.literal("exit"), code: z.number().nullable() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type AirAppRuntimeEvent = z.infer<typeof airAppRuntimeEventSchema>;

export const airappRuntimeContract = {
  runLocalNode: oc
    .input(airAppRunLocalNodeInputSchema)
    .output(eventIterator(airAppRuntimeEventSchema)),
};
