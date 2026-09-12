import { iStringSchema } from "openlib/i18n/i-string";
import { z } from "zod";

/**
 * Per-node custom scenario prompts (`node.agentPrompts`) — the single
 * schema shared by BOTH write and read paths, per the node-agent-prompts
 * design (v2) §7.3:
 *
 * - Write: `busabase-cli nodes set-agent-prompts` validates a file against this
 *   schema client-side, before calling `nodes.updateAgentPrompts` — a malformed
 *   file never reaches the network.
 * - Read: `buildNodeAgentPrompts` (`packages/busabase-core/.../node-agent-prompts.ts`)
 *   `.safeParse`s whatever is stored in the node's `agentPrompts` column and
 *   ignores invalid custom entries, so a bad write (or a manual jsonb edit) can
 *   never crash the Agent Prompts dialog or hide its built-in scenarios.
 *
 * One schema, one place to edit the limits — do not duplicate this validation on
 * either side.
 */

/** Recommended limits from the spec (§7.3) — kept as named constants so a limit
 * change has exactly one place to edit, and so error messages can cite them. */
export const CUSTOM_AGENT_PROMPT_LIMITS = {
  /** Max custom prompts per node. */
  maxPrompts: 50,
  /** Max characters per localized `label` value. */
  maxLabelChars: 80,
  /** Max bytes (UTF-8) per localized `body` value. */
  maxBodyBytes: 8 * 1024,
} as const;

/** Same intent vocabulary `PromptDef.intent` uses — `change` is the router-side
 * default when omitted, matching the existing curated-prompt behavior. */
export const customPromptIntentSchema = z.enum(["read-only", "change"]);
export type CustomPromptIntent = z.infer<typeof customPromptIntentSchema>;

const iStringLocaleValues = (value: z.infer<typeof iStringSchema>): string[] =>
  typeof value === "string" ? [value] : Object.values(value);

/** UTF-8 byte length — `body` includes CJK/JA text, whose per-character byte
 * cost is not 1, so a character-count limit alone would under-enforce §7.3's
 * "8 KiB per localized body" budget. */
const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).length;

const customPromptLabelSchema = iStringSchema.refine(
  (value) =>
    iStringLocaleValues(value).every((v) => v.length <= CUSTOM_AGENT_PROMPT_LIMITS.maxLabelChars),
  {
    message: `label must be at most ${CUSTOM_AGENT_PROMPT_LIMITS.maxLabelChars} characters per locale`,
  },
);

const customPromptBodySchema = iStringSchema.refine(
  (value) =>
    iStringLocaleValues(value).every(
      (v) => utf8ByteLength(v) <= CUSTOM_AGENT_PROMPT_LIMITS.maxBodyBytes,
    ),
  {
    message: `body must be at most ${CUSTOM_AGENT_PROMPT_LIMITS.maxBodyBytes} bytes (UTF-8) per locale`,
  },
);

/**
 * One custom scenario prompt. `body`'s `{target}` placeholder is substituted at
 * render time with the same target string `PromptDef.body(target)` receives
 * today (see `node-agent-prompts.ts`) — this schema does not interpolate it.
 *
 * The placeholder is OPTIONAL and chooses placement only: a `body` that never
 * mentions `{target}` gets the target line prepended as its first paragraph, so
 * a custom prompt can never reach an agent without naming the node it acts on.
 * That is why the schema does not require it — forgetting it is not an error to
 * reject, it is a default to supply.
 */
export const customPromptDefSchema = z.object({
  /** Stable id, unique within this node's custom list. */
  key: z.string().trim().min(1, { message: "key must not be empty" }),
  /** Defaults to `change` (same default the curated prompts use) so a prompt
   * cannot silently opt out of the change-request path by omission — whether that
   * path then merges immediately or waits for review is the permission layer's
   * call, not the prompt's. */
  intent: customPromptIntentSchema.optional(),
  /** Short title shown in the dialog's left list. */
  label: customPromptLabelSchema,
  /** Template text; "{target}" is substituted with the rendered target line. */
  body: customPromptBodySchema,
});
export type CustomPromptDef = z.infer<typeof customPromptDefSchema>;

/**
 * The full `agentPrompts` array. `.max` bounds the list; the
 * `superRefine` catches duplicate keys with an issue path pointing at the
 * offending entry, so a CLI/server validation error names which entry and
 * which key collided instead of a bare "keys must be unique".
 */
export const customAgentPromptsSchema = z
  .array(customPromptDefSchema)
  .max(CUSTOM_AGENT_PROMPT_LIMITS.maxPrompts, {
    message: `at most ${CUSTOM_AGENT_PROMPT_LIMITS.maxPrompts} custom prompts per node`,
  })
  .superRefine((prompts, ctx) => {
    const firstIndexByKey = new Map<string, number>();
    prompts.forEach((prompt, index) => {
      const firstIndex = firstIndexByKey.get(prompt.key);
      if (firstIndex === undefined) {
        firstIndexByKey.set(prompt.key, index);
        return;
      }
      ctx.addIssue({
        code: "custom",
        path: [index, "key"],
        message: `duplicate key "${prompt.key}" — already used at entry ${firstIndex + 1}`,
      });
    });
  });
export type CustomAgentPrompts = z.infer<typeof customAgentPromptsSchema>;
