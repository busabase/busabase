/**
 * Node line-range read — DTO for `nodes.readLines`.
 *
 * Lives here rather than in a rich-node types file because the endpoint is
 * type-agnostic (it serves doc/html/whiteboard/workflow alike) and this is
 * where its Doc-only predecessor `docs.readLines` was defined. Pure zod, no
 * logic/db imports (client-safe).
 */
import { z } from "zod";

/**
 * `GET /nodes/{nodeId}/lines?startLine&endLine` — range capped, see
 * `logic/node-content.ts`'s `readNodeLines` (busabase-core). Output reuses
 * `ReadLinesVOSchema` from the assets domain directly (identical shape, no
 * reason to redefine it) — see `packages/busabase-contract/src/domains/doc/contract.ts`.
 */
export const ReadNodeLinesInputSchema = z.object({
  nodeId: z.string(),
  startLine: z.coerce
    .number()
    .int()
    .min(1)
    .describe("First line to read. 1-indexed, and INCLUSIVE."),
  endLine: z.coerce
    .number()
    .int()
    .min(1)
    .describe(
      "Last line to read, INCLUSIVE. A range wider than 2000 lines is silently narrowed to " +
        "the first 2000 rather than rejected — the response reports `lineCountCapped` when " +
        "that happened, so check it before concluding the file ends there.",
    ),
});
export type ReadNodeLinesInput = z.infer<typeof ReadNodeLinesInputSchema>;
