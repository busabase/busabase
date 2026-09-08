import { z } from "zod";
/**
 * Per-node custom scenario prompts (`node.metadata.agentPrompts`) — the single
 * schema shared by BOTH write and read paths, per
 * `apps/busabase-cloud/content/spec/node-agent-prompts-v2.md` §7.3:
 *
 * - Write: `busabase-cli nodes set-agent-prompts` validates a file against this
 *   schema client-side, before calling `nodes.updateMetadata` — a malformed file
 *   never reaches the network.
 * - Read: `buildNodeAgentPrompts` (`packages/busabase-core/.../node-agent-prompts.ts`)
 *   `.safeParse`s whatever is stored in `metadata.agentPrompts` and falls back to
 *   the node type's default scenarios on failure, so a bad write (or a manual
 *   jsonb edit) can never crash the Agent Prompts dialog.
 *
 * One schema, one place to edit the limits — do not duplicate this validation on
 * either side.
 */
/** Recommended limits from the spec (§7.3) — kept as named constants so a limit
 * change has exactly one place to edit, and so error messages can cite them. */
export declare const CUSTOM_AGENT_PROMPT_LIMITS: {
  /** Max custom prompts per node. */
  readonly maxPrompts: 50;
  /** Max characters per localized `label` value. */
  readonly maxLabelChars: 80;
  /** Max bytes (UTF-8) per localized `body` value. */
  readonly maxBodyBytes: number;
};
/** Same intent vocabulary `PromptDef.intent` uses — `change` is the router-side
 * default when omitted, matching the existing curated-prompt behavior. */
export declare const customPromptIntentSchema: z.ZodEnum<{
  change: "change";
  "read-only": "read-only";
}>;
export type CustomPromptIntent = z.infer<typeof customPromptIntentSchema>;
/**
 * One custom scenario prompt. `body`'s `{target}` placeholder is substituted at
 * render time with the same target string `PromptDef.body(target)` receives
 * today (see `node-agent-prompts.ts`) — this schema does not interpolate it.
 */
export declare const customPromptDefSchema: z.ZodObject<
  {
    key: z.ZodString;
    intent: z.ZodOptional<
      z.ZodEnum<{
        change: "change";
        "read-only": "read-only";
      }>
    >;
    label: z.ZodUnion<
      readonly [
        z.ZodString,
        z.ZodRecord<
          z.ZodEnum<{
            de: "de";
            en: "en";
            es: "es";
            fr: "fr";
            ja: "ja";
            ko: "ko";
            pt: "pt";
            "zh-CN": "zh-CN";
            "zh-TW": "zh-TW";
          }> &
            z.core.$partial,
          z.ZodString
        >,
      ]
    >;
    body: z.ZodUnion<
      readonly [
        z.ZodString,
        z.ZodRecord<
          z.ZodEnum<{
            de: "de";
            en: "en";
            es: "es";
            fr: "fr";
            ja: "ja";
            ko: "ko";
            pt: "pt";
            "zh-CN": "zh-CN";
            "zh-TW": "zh-TW";
          }> &
            z.core.$partial,
          z.ZodString
        >,
      ]
    >;
  },
  z.core.$strip
>;
export type CustomPromptDef = z.infer<typeof customPromptDefSchema>;
/**
 * The full `metadata.agentPrompts` array. `.max` bounds the list; the
 * `superRefine` catches duplicate keys with an issue path pointing at the
 * offending entry, so a CLI/server validation error names which entry and
 * which key collided instead of a bare "keys must be unique".
 */
export declare const customAgentPromptsSchema: z.ZodArray<
  z.ZodObject<
    {
      key: z.ZodString;
      intent: z.ZodOptional<
        z.ZodEnum<{
          change: "change";
          "read-only": "read-only";
        }>
      >;
      label: z.ZodUnion<
        readonly [
          z.ZodString,
          z.ZodRecord<
            z.ZodEnum<{
              de: "de";
              en: "en";
              es: "es";
              fr: "fr";
              ja: "ja";
              ko: "ko";
              pt: "pt";
              "zh-CN": "zh-CN";
              "zh-TW": "zh-TW";
            }> &
              z.core.$partial,
            z.ZodString
          >,
        ]
      >;
      body: z.ZodUnion<
        readonly [
          z.ZodString,
          z.ZodRecord<
            z.ZodEnum<{
              de: "de";
              en: "en";
              es: "es";
              fr: "fr";
              ja: "ja";
              ko: "ko";
              pt: "pt";
              "zh-CN": "zh-CN";
              "zh-TW": "zh-TW";
            }> &
              z.core.$partial,
            z.ZodString
          >,
        ]
      >;
    },
    z.core.$strip
  >
>;
export type CustomAgentPrompts = z.infer<typeof customAgentPromptsSchema>;
