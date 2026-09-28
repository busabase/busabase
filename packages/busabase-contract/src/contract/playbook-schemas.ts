/**
 * Playbooks — the skills and custom node prompts a space already defines for a
 * job — top-level, domain-agnostic schemas for `POST /playbooks/search` and
 * `GET /playbooks/{kind}/{nodeId}`.
 *
 * Top-level (like `grep-schemas.ts`) rather than inside one domain's contract,
 * because a playbook is either a Skill node or a prompt stored on ANY node type:
 * the surface composes several domains.
 *
 * The server does no intent recognition. The agent sends several phrasings of
 * what the user wants; the server matches them as case-insensitive substrings
 * against skill name/slug/description and prompt label/body, and ranks. See
 * `apps/busabase/content/spec/agent-playbook-discovery.md` §6.
 *
 * Pure zod — no logic/db imports (client-safe: pulled into the browser bundle
 * and the RN oRPC client's type graph).
 */
import { z } from "zod";

/** Named so a limit change has exactly one place to edit, and error messages can cite it. */
export const PLAYBOOK_SEARCH_LIMITS = {
  /** Max phrasings per search. */
  maxQueries: 8,
  /** Max characters per phrasing. */
  maxQueryChars: 200,
  /** Default number of items returned for a non-empty search. */
  defaultLimit: 10,
  /** Hard cap on `limit`. */
  maxLimit: 50,
  /** An empty `queries` (browse) returns at most this many, nearest first. */
  browseLimit: 30,
  /** How much of a prompt body (per locale) is matched against. */
  bodyPrefixChars: 500,
} as const;

export const PlaybookKindSchema = z.enum(["skill", "prompt"]);
export type PlaybookKind = z.infer<typeof PlaybookKindSchema>;

/** Why an item matched. `name`/`slug`/`description` are skill fields; `label`/`body` are prompt fields. */
export const PlaybookMatchFieldSchema = z.enum(["name", "slug", "description", "label", "body"]);
export type PlaybookMatchField = z.infer<typeof PlaybookMatchFieldSchema>;

const localeSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .describe(
    'Locale for prompt labels and the rendered prompt body, e.g. "en" or "zh-CN". Falls back to English, then to whatever locale the prompt has.',
  );

export const PlaybookSearchInputSchema = z.object({
  queries: z
    .array(z.string().max(PLAYBOOK_SEARCH_LIMITS.maxQueryChars))
    .max(PLAYBOOK_SEARCH_LIMITS.maxQueries)
    .default([])
    .describe(
      '2–5 phrasings of what the user wants, in the user\'s language AND in English (e.g. ["记录客户拜访", "log customer visit", "visit"]). Each is matched as a case-insensitive substring; an item hit by more phrasings ranks higher. Empty = browse: every playbook, nearest first (at most 30).',
    ),
  kinds: z
    .array(PlaybookKindSchema)
    .optional()
    .describe('Restrict to "skill" and/or "prompt". Default: both.'),
  nearNodeId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "The node the user is on. Playbooks on that node rank first, then its folder, then ancestor folders (closest first).",
    ),
  inNodeId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Only return playbooks on this node or inside its subtree."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PLAYBOOK_SEARCH_LIMITS.maxLimit)
    .optional()
    .describe("Max items (1–50). Default 10 for a search; 30 for a browse."),
  locale: localeSchema.optional(),
});
export type PlaybookSearchInputDTO = z.input<typeof PlaybookSearchInputSchema>;

/** Fields shared by a search item and a get result: where the playbook lives. */
const playbookLocationShape = {
  kind: PlaybookKindSchema,
  nodeId: z.string(),
  nodeType: z.string(),
  nodeName: z.string(),
  nodeSlug: z.string(),
  /** Folder names from the workspace root down to the node's parent. Tells two same-named playbooks apart. */
  path: z.array(z.string()),
};

export const PlaybookSearchItemVOSchema = z.object({
  ...playbookLocationShape,
  /** Prompts only: the key to pass to `playbooks.get`. */
  key: z.string().optional(),
  /** Prompts only: the label in the requested locale (fallback `en`, then any). */
  label: z.string().optional(),
  /** Prompts only: `read-only` never writes; `change` goes through a change request. */
  intent: z.enum(["read-only", "change"]).optional(),
  /** Skills only: the skill's name. */
  name: z.string().optional(),
  /** Skills only: the skill's description (follows its SKILL.md frontmatter). */
  description: z.string().optional(),
  matchedOn: z.array(PlaybookMatchFieldSchema),
  /** For debugging and tests. Rely on the ORDER of `items`, not on this number. */
  score: z.number(),
  updatedAt: z.string(),
});
export type PlaybookSearchItemVO = z.infer<typeof PlaybookSearchItemVOSchema>;

export const PlaybookSearchResultVOSchema = z.object({
  items: z.array(PlaybookSearchItemVOSchema),
  /** Every matching playbook the caller can read — not just the ones returned. */
  total: z.number().int(),
  /** True when `total` is larger than `items`. Narrow the search rather than paging. */
  truncated: z.boolean(),
  coverage: z.object({
    /** Skill nodes considered (after permission, `kinds`, and `inNodeId` filters). */
    skillsScanned: z.number().int(),
    /** Nodes carrying custom prompts that were considered. */
    promptNodesScanned: z.number().int(),
  }),
});
export type PlaybookSearchResultVO = z.infer<typeof PlaybookSearchResultVOSchema>;

/**
 * `playbooks.list` — the whole catalog, for the dashboard's Playbooks page (the
 * person WRITING playbooks wants to see all of them). Internal RPC only: agents
 * get the ranked, bounded `search` instead, so this never reaches REST or MCP.
 */
export const PLAYBOOK_LIST_LIMITS = {
  /** Hard cap on items returned. `total` still counts everything readable. */
  maxItems: 1000,
  /** Characters of a prompt body shown as its one-line preview. */
  bodyPreviewChars: 200,
} as const;

export const PlaybookListInputSchema = z.object({
  kinds: z
    .array(PlaybookKindSchema)
    .optional()
    .describe('Restrict to "skill" and/or "prompt". Default: both.'),
  locale: localeSchema.optional(),
});
export type PlaybookListInputDTO = z.input<typeof PlaybookListInputSchema>;

/** Days `PlaybookUsageVO.changeRequests30d` looks back. */
export const PLAYBOOK_USAGE_WINDOW_DAYS = 30;

/**
 * Usage of one playbook, from the change requests agents wrote while following
 * it. Every status counts (in review, merged, rejected, …): the question is
 * "do agents find and follow this?", and a rejected change still proves they
 * did — the rejection is about the change, not about the playbook being found.
 */
export const PlaybookUsageVOSchema = z.object({
  /** Change requests citing this playbook created in the last `PLAYBOOK_USAGE_WINDOW_DAYS` days. */
  changeRequests30d: z.number().int(),
  /** ISO time of the newest change request citing it, at any age; null when none ever did. */
  lastUsedAt: z.string().nullable(),
});
export type PlaybookUsageVO = z.infer<typeof PlaybookUsageVOSchema>;

export const PlaybookListItemVOSchema = z.object({
  ...playbookLocationShape,
  /** Prompts only: the key to pass to `playbooks.get`. */
  key: z.string().optional(),
  /** Prompts only: the label in the requested locale (fallback `en`, then any). */
  label: z.string().optional(),
  /** Prompts only: `read-only` never writes; `change` goes through a change request. */
  intent: z.enum(["read-only", "change"]).optional(),
  /** Prompts only: the start of the body in the requested locale, whitespace collapsed. */
  bodyPreview: z.string().optional(),
  /** Skills only: the skill's name. */
  name: z.string().optional(),
  /** Skills only: the skill's description (follows its SKILL.md frontmatter). */
  description: z.string().optional(),
  updatedAt: z.string(),
  /**
   * How often agents cited this playbook on their writes (the `x-busabase-playbook`
   * attribution, spec §11b H1). Counts only change requests the viewer can see.
   * Optional so an older server's response still parses.
   */
  usage: PlaybookUsageVOSchema.optional(),
});
export type PlaybookListItemVO = z.infer<typeof PlaybookListItemVOSchema>;

export const PlaybookListResultVOSchema = z.object({
  /** Sorted by folder path, then skills before prompts, then name/label. */
  items: z.array(PlaybookListItemVOSchema),
  /** Every playbook the caller can read — not just the ones returned. */
  total: z.number().int(),
  /** True when `total` is larger than `items` (more than `PLAYBOOK_LIST_LIMITS.maxItems`). */
  truncated: z.boolean(),
});
export type PlaybookListResultVO = z.infer<typeof PlaybookListResultVOSchema>;

export const PlaybookGetInputSchema = z
  .object({
    kind: PlaybookKindSchema,
    nodeId: z.string().trim().min(1),
    key: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Required for a prompt: the `key` from `playbooks.search`."),
    locale: localeSchema
      .optional()
      .describe(
        'Locale for the prompt label and rendered body, e.g. "en" or "zh-CN" — pass the user\'s. Without one (or with a locale the dashboard does not speak) the body is rendered in English and its footer says "Reply in the user\'s language." instead of naming a language.',
      ),
  })
  .superRefine((input, ctx) => {
    if (input.kind === "prompt" && !input.key) {
      ctx.addIssue({ code: "custom", path: ["key"], message: "key is required for a prompt" });
    }
  });
export type PlaybookGetInputDTO = z.input<typeof PlaybookGetInputSchema>;

export const PlaybookFileVOSchema = z.object({
  path: z.string(),
  size: z.number(),
  mimeType: z.string().nullable(),
});
export type PlaybookFileVO = z.infer<typeof PlaybookFileVOSchema>;

export const PlaybookGetVOSchema = z.object({
  ...playbookLocationShape,
  /**
   * What to follow. A prompt: its body rendered exactly as Ask Agent sends it
   * (target line, merge-policy and reply-language footer). A skill: `SKILL.md`.
   */
  content: z.string(),
  /** Prompts only. */
  key: z.string().optional(),
  label: z.string().optional(),
  intent: z.enum(["read-only", "change"]).optional(),
  /** Prompts only: the locale the body was rendered in. */
  locale: z.string().optional(),
  /** Skills only. */
  name: z.string().optional(),
  description: z.string().optional(),
  /** Skills only: every file in the skill. Read more with CLI `skills read-file` / MCP `node_file_read`. */
  files: z.array(PlaybookFileVOSchema).optional(),
});
export type PlaybookGetVO = z.infer<typeof PlaybookGetVOSchema>;

// ── Attribution: which playbook produced a change request ────────────────────

/**
 * The one request header an agent uses to say which playbook it is following:
 * `x-busabase-playbook: <kind>:<nodeId>[:<key>]` (a prompt needs its key). The
 * server validates it and records the playbook on every change request the
 * request creates — see spec §11b (H1). The CLI's `--playbook`, the SDK's
 * `playbook` option, and the MCP `playbook` argument all become this header.
 */
export const BUSABASE_PLAYBOOK_HEADER = "x-busabase-playbook";

/** A parsed, NOT yet validated playbook reference as the caller sent it. */
export interface PlaybookRef {
  kind: PlaybookKind;
  nodeId: string;
  key: string | null;
}

const MAX_PLAYBOOK_REF_CHARS = 512;

/**
 * Parse `<kind>:<nodeId>[:<key>]`. Everything after the second colon is the key
 * (a prompt key may itself contain colons). Returns null for anything
 * malformed — a prompt without a key, a skill with one, an unknown kind — so a
 * bad value is dropped, never guessed at.
 */
export const parsePlaybookRef = (value: string | null | undefined): PlaybookRef | null => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > MAX_PLAYBOOK_REF_CHARS) return null;
  const first = trimmed.indexOf(":");
  if (first <= 0) return null;
  const kind = PlaybookKindSchema.safeParse(trimmed.slice(0, first));
  if (!kind.success) return null;
  const rest = trimmed.slice(first + 1);
  const second = rest.indexOf(":");
  const nodeId = (second === -1 ? rest : rest.slice(0, second)).trim();
  const key = second === -1 ? null : rest.slice(second + 1).trim() || null;
  if (!nodeId) return null;
  if (kind.data === "prompt" && !key) return null;
  if (kind.data === "skill" && key) return null;
  return { kind: kind.data, nodeId, key };
};

/** Inverse of `parsePlaybookRef`. */
export const formatPlaybookRef = (ref: PlaybookRef): string =>
  ref.key ? `${ref.kind}:${ref.nodeId}:${ref.key}` : `${ref.kind}:${ref.nodeId}`;

/**
 * The playbook a change request (or audit event) was produced by, as a reader
 * sees it. `accessible: false` means the playbook node exists in the record
 * but the current reader cannot read it: only the kind is disclosed, every
 * identifying field is null, and the UI shows "via a playbook" with no link.
 * The label is filled in by the server from the node itself when the write was
 * made — never taken from the caller.
 */
export const PlaybookAttributionVOSchema = z.object({
  kind: PlaybookKindSchema,
  accessible: z.boolean(),
  nodeId: z.string().nullable(),
  /** Prompts only (null for a skill, or when not accessible). */
  key: z.string().nullable(),
  nodeType: z.string().nullable(),
  nodeSlug: z.string().nullable(),
  label: z.string().nullable(),
});
export type PlaybookAttributionVO = z.infer<typeof PlaybookAttributionVOSchema>;
