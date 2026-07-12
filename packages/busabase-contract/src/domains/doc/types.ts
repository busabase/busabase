/**
 * Doc — VO/DTO Zod schemas that don't already live inline in contract.ts
 * (`docSchema`, `createDocInputSchema`, etc. stay there). This file exists
 * for `readLines`, mirroring the assets domain's `types.ts` co-location
 * convention. Pure zod, no logic/db imports (client-safe).
 */
import { z } from "zod";

/**
 * `GET /docs/{nodeId}/lines?startLine&endLine` — range capped, see
 * `domains/doc/handlers.ts`'s `readDocLines` (busabase-core). Output reuses
 * `ReadLinesVOSchema` from the assets domain directly (identical shape, no
 * reason to redefine it) — see `packages/busabase-contract/src/domains/doc/contract.ts`.
 */
export const ReadDocLinesInputSchema = z.object({
  nodeId: z.string(),
  startLine: z.coerce.number().int().min(1),
  endLine: z.coerce.number().int().min(1),
});
export type ReadDocLinesInput = z.infer<typeof ReadDocLinesInputSchema>;
