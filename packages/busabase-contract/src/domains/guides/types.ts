/**
 * Guides — the operating manual, as VOs.
 *
 * The manual existed only over MCP: `instructions`, `resources/*` and the
 * `busabase_guide` tool. Anything driving the REST API — busabase-cli, a script,
 * a CI step, an AirApp — was told nothing about the change-request rules, the
 * field types, or the AirApp runtime contract, and was then judged on whether it
 * guessed the house rules. These routes publish the same documents, built from
 * the same source, so the two surfaces cannot drift.
 */
import { z } from "zod";

export const GuideKindSchema = z.enum(["reference", "walkthrough"]);
export type GuideKind = z.infer<typeof GuideKindSchema>;

/** One catalog entry — enough to choose a topic without fetching every document. */
export const GuideTopicVOSchema = z.object({
  topic: z.string(),
  title: z.string(),
  /** `reference` = read it and apply it. `walkthrough` = a workflow to run WITH the user. */
  kind: GuideKindSchema,
  summary: z.string(),
});
export type GuideTopicVO = z.infer<typeof GuideTopicVOSchema>;

export const GuideVOSchema = z.object({
  topic: z.string(),
  title: z.string(),
  kind: GuideKindSchema,
  /** The document itself, markdown. */
  content: z.string(),
  /** The other topics this deployment serves, so one call is enough to keep going. */
  otherTopics: z.array(z.string()),
});
export type GuideVO = z.infer<typeof GuideVOSchema>;

export const ReadGuideInputSchema = z.object({
  topic: z.string().min(1).describe("Guide topic. Call `GET /guides` for the ones served here."),
});
export type ReadGuideDTO = z.infer<typeof ReadGuideInputSchema>;
