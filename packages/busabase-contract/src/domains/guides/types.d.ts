/**
 * Guides — the operating manual, as VOs.
 *
 * The manual existed only over MCP: `instructions`, `resources/*` and the
 * `busabase_guide` tool. Anything driving the REST API — busabase-cli, a script,
 * a CI step, an AirApp — was told nothing about the approval-first rules, the
 * field types, or the AirApp runtime contract, and was then judged on whether it
 * guessed the house rules. These routes publish the same documents, built from
 * the same source, so the two surfaces cannot drift.
 */
import { z } from "zod";
export declare const GuideKindSchema: z.ZodEnum<{
  reference: "reference";
  walkthrough: "walkthrough";
}>;
export type GuideKind = z.infer<typeof GuideKindSchema>;
/** One catalog entry — enough to choose a topic without fetching every document. */
export declare const GuideTopicVOSchema: z.ZodObject<
  {
    topic: z.ZodString;
    title: z.ZodString;
    kind: z.ZodEnum<{
      reference: "reference";
      walkthrough: "walkthrough";
    }>;
    summary: z.ZodString;
  },
  z.core.$strip
>;
export type GuideTopicVO = z.infer<typeof GuideTopicVOSchema>;
export declare const GuideVOSchema: z.ZodObject<
  {
    topic: z.ZodString;
    title: z.ZodString;
    kind: z.ZodEnum<{
      reference: "reference";
      walkthrough: "walkthrough";
    }>;
    content: z.ZodString;
    otherTopics: z.ZodArray<z.ZodString>;
  },
  z.core.$strip
>;
export type GuideVO = z.infer<typeof GuideVOSchema>;
export declare const ReadGuideInputSchema: z.ZodObject<
  {
    topic: z.ZodString;
  },
  z.core.$strip
>;
export type ReadGuideDTO = z.infer<typeof ReadGuideInputSchema>;
