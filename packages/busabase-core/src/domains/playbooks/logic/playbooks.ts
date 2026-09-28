import "server-only";

/**
 * Playbook discovery — `playbooks.search` / `playbooks.get`, plus
 * `playbooks.list` (the dashboard's whole-catalog Playbooks page).
 *
 * A playbook is either a Skill node or one custom scenario prompt stored on a
 * node (`busabase_nodes.agent_prompts`). The agent sends 2–5 phrasings of the
 * user's intent; this module matches them as case-insensitive substrings and
 * ranks the hits. It deliberately does NOT understand language: the agent does
 * the translating, which keeps the endpoint cheap, deterministic, and working
 * for CJK text that Postgres' `simple` tsvector cannot tokenize at all. See
 * `apps/busabase/content/spec/agent-playbook-discovery.md` §6.
 *
 * Every DB read lives here (logic owns data access); the router is a one-line
 * delegation.
 */

import { ORPCError } from "@orpc/server";
import { customAgentPromptsSchema } from "busabase-contract/contract/node-agent-prompt-schemas";
import {
  PLAYBOOK_LIST_LIMITS,
  PLAYBOOK_SEARCH_LIMITS,
  PLAYBOOK_USAGE_WINDOW_DAYS,
  type PlaybookGetInputDTO,
  PlaybookGetInputSchema,
  type PlaybookGetVO,
  type PlaybookKind,
  type PlaybookListInputDTO,
  PlaybookListInputSchema,
  type PlaybookListItemVO,
  type PlaybookListResultVO,
  type PlaybookMatchField,
  type PlaybookSearchInputDTO,
  PlaybookSearchInputSchema,
  type PlaybookSearchItemVO,
  type PlaybookSearchResultVO,
  type PlaybookUsageVO,
} from "busabase-contract/contract/playbook-schemas";
import { and, eq, gte, isNotNull, isNull, max, or, sql } from "drizzle-orm";
import { type iString, iStringParse, type LocaleType } from "openlib/i18n/i-string";
import { getContextIsSpaceManager, getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { busabaseChangeRequests, busabaseNodes } from "../../../db/schema";
import { type CoreLocale, coreMessagesByLocale } from "../../../i18n/catalog";
import {
  CHANGE_REQUEST_ACL_BATCH_SIZE,
  filterVisibleChangeRequestRows,
} from "../../../logic/cr-lifecycle";
import { buildNodeVisibilityCondition } from "../../../logic/node-acl";
import {
  ancestorsOf,
  loadNodeTree,
  type NodeTree,
  nodePathOf,
  type TreeNode,
} from "../../../logic/node-tree";
import { ensureReady } from "../../../logic/seed";
import { buildNodeAgentPrompts } from "../../dashboard/helpers/node-agent-prompts";
import { listSkillFiles, readSkillFile } from "../../skill/handlers";

type Db = Awaited<ReturnType<typeof getDb>>;

const SKILL_ENTRY_FILE = "SKILL.md";

/** §6.2 field weights. Name and slug are one field for scoring: a hit on both still counts once. */
const FIELD_WEIGHT = { nameOrSlug: 3, description: 2, label: 3, body: 1 } as const;

/** Rank bucket for "not related to `nearNodeId` at all" (and for "no `nearNodeId` given"). */
const FAR = Number.MAX_SAFE_INTEGER;

// ── Locale helpers ────────────────────────────────────────────────────────────

const isCoreLocale = (locale: string | undefined): locale is CoreLocale =>
  locale !== undefined && locale in coreMessagesByLocale;

/** The render locale: the requested one when the dashboard speaks it, else English. */
const toCoreLocale = (locale: string | undefined): CoreLocale =>
  isCoreLocale(locale) ? locale : "en";

/** Requested locale, then `en`, then the first available — `iStringParse`'s own fallback order. */
const localized = (value: iString, locale: string | undefined): string =>
  iStringParse(value, (locale ?? "en") as LocaleType);

/** Every locale's value of an iString, for matching "in every locale". */
const allLocaleValues = (value: iString): string[] =>
  typeof value === "string" ? [value] : Object.values(value).filter((v) => typeof v === "string");

// ── Candidate load ────────────────────────────────────────────────────────────

/**
 * Per-node projection of `agent_prompts` that never ships a full body: each
 * entry keeps its `key`/`intent`/`label` and only the first N characters of its
 * `body` (per locale when the body is a locale map). A corrupt value (not an
 * array, an entry that is not an object) degrades to entries the schema then
 * rejects, never to a SQL error.
 *
 * `jsonb_strip_nulls` because `jsonb_build_object` turns an absent key into a
 * JSON null, which the optional zod fields reject.
 *
 * `jsonb_typeof` is checked inside a CASE rather than an AND: Postgres does not
 * promise to evaluate AND operands left to right, and `jsonb_array_elements` on
 * a non-array raises.
 */
const promptPreviewSql = (
  bodyPrefix: number,
) => sql<unknown>`case when jsonb_typeof(${busabaseNodes.agentPrompts}) = 'array' then (
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'key', e.value -> 'key',
    'intent', e.value -> 'intent',
    'label', e.value -> 'label',
    'body', case jsonb_typeof(e.value -> 'body')
      when 'string' then to_jsonb(left(e.value ->> 'body', ${bodyPrefix}))
      when 'object' then (
        select jsonb_object_agg(b.key, case jsonb_typeof(b.value) when 'string' then to_jsonb(left(b.value #>> '{}', ${bodyPrefix})) else b.value end)
        from jsonb_each(e.value -> 'body') as b
      )
      else e.value -> 'body'
    end
  )) order by e.ordinality), '[]'::jsonb)
  from jsonb_array_elements(${busabaseNodes.agentPrompts}) with ordinality as e(value, ordinality)
  where jsonb_typeof(e.value) = 'object'
) else null end`;

/** Node has a non-empty custom prompt list. Shared with `grep`'s `prompts` source so both pick the same nodes. */
export const hasCustomPromptsSql = sql<boolean>`(case when jsonb_typeof(${busabaseNodes.agentPrompts}) = 'array' then jsonb_array_length(${busabaseNodes.agentPrompts}) > 0 else false end)`;

/**
 * §6.2 proximity to `nearNodeId`, lower is nearer:
 *   0 the node itself · 1 same folder (a sibling, or a child when the near node
 *   IS the folder) · 2.. an ancestor folder of the near node, closest first ·
 *   FAR anywhere else.
 */
const proximityRanker = (byId: Map<string, TreeNode>, nearNodeId: string | undefined) => {
  if (!nearNodeId || !byId.has(nearNodeId)) return () => FAR;
  const nearParent = byId.get(nearNodeId)?.parentId ?? null;
  const ancestors = ancestorsOf(byId, nearNodeId);
  // ancestors[0] is nearParent (same folder); ancestors[i >= 1] are further up.
  const ancestorRank = new Map(ancestors.map((id, index) => [id, index + 1]));
  return (candidateId: string): number => {
    if (candidateId === nearNodeId) return 0;
    // An enclosing folder is as near as the nodes directly inside it: the
    // folder the user is working in outranks a sibling folder's contents.
    const asAncestor = ancestorRank.get(candidateId);
    if (asAncestor !== undefined) return asAncestor;
    const parent = byId.get(candidateId)?.parentId ?? null;
    if (!parent) return FAR;
    if (parent === nearNodeId || parent === nearParent) return 1;
    return ancestorRank.get(parent) ?? FAR;
  };
};

const isInSubtree = (byId: Map<string, TreeNode>, rootId: string, nodeId: string): boolean =>
  nodeId === rootId || ancestorsOf(byId, nodeId).includes(rootId);

// ── Matching ──────────────────────────────────────────────────────────────────

interface Field {
  name: PlaybookMatchField;
  /** Score group: fields in the same group score once however many of them hit. */
  group: keyof typeof FIELD_WEIGHT;
  texts: string[];
}

interface Candidate {
  item: Omit<PlaybookSearchItemVO, "matchedOn" | "score">;
  fields: Field[];
  updatedAtMs: number;
  /** Prompts only: the requested-locale body prefix, for `playbooks.list`'s preview. */
  bodyPrefix?: string;
}

/**
 * §6.2 score: the summed weights of every field group any query hit, times
 * the number of DISTINCT queries that hit at least one field. A playbook three
 * phrasings agree on outranks one a single stray word touched.
 */
const scoreCandidate = (
  candidate: Candidate,
  queries: string[],
): { score: number; matchedOn: PlaybookMatchField[] } => {
  const lowered = candidate.fields.map((field) => ({
    ...field,
    texts: field.texts.map((text) => text.toLowerCase()),
  }));
  const matchedFields = new Set<PlaybookMatchField>();
  const matchedGroups = new Set<keyof typeof FIELD_WEIGHT>();
  let queriesHit = 0;
  for (const query of queries) {
    let hit = false;
    for (const field of lowered) {
      if (field.texts.some((text) => text.includes(query))) {
        hit = true;
        matchedFields.add(field.name);
        matchedGroups.add(field.group);
      }
    }
    if (hit) queriesHit += 1;
  }
  const weight = [...matchedGroups].reduce((sum, group) => sum + FIELD_WEIGHT[group], 0);
  const order: PlaybookMatchField[] = ["name", "slug", "label", "description", "body"];
  return {
    score: weight * queriesHit,
    matchedOn: order.filter((field) => matchedFields.has(field)),
  };
};

/** Normalize the phrasings: trimmed, lowercased, de-duplicated, blanks dropped. */
const normalizeQueries = (queries: readonly string[]): string[] => [
  ...new Set(queries.map((query) => query.trim().toLowerCase()).filter(Boolean)),
];

// ── Shared candidate load (search + list) ─────────────────────────────────────

export interface LoadCandidatesOptions {
  kinds: ReadonlySet<PlaybookKind>;
  locale: string | undefined;
  /** Only playbooks on this node or inside its subtree. */
  inNodeId?: string;
}

/** One node as the candidate builder needs it; the DB query and the demo dataset both produce these. */
export interface PlaybookNodeRow {
  id: string;
  parentId: string | null;
  type: string;
  name: string;
  slug: string;
  description: string;
  updatedAt: Date;
  /** The node's `agent_prompts` (bodies may be truncated to a preview prefix); validated here. */
  prompts: unknown;
}

/**
 * Project node rows into search/list candidates. Pure: the real store feeds it
 * rows from Postgres, the demo router feeds it the in-memory seed, so both
 * apply exactly the same skill/prompt rules and the same ranking downstream.
 */
export const buildPlaybookCandidates = (
  rows: readonly PlaybookNodeRow[],
  tree: NodeTree,
  options: LoadCandidatesOptions,
) => {
  const { byId, visibleIds } = tree;
  const wantSkills = options.kinds.has("skill");
  const wantPrompts = options.kinds.has("prompt");
  const { inNodeId } = options;
  const inSubtree = (nodeId: string) =>
    inNodeId === undefined ||
    ((visibleIds === null || visibleIds.has(inNodeId)) && isInSubtree(byId, inNodeId, nodeId));

  const candidates: Candidate[] = [];
  let skillsScanned = 0;
  let promptNodesScanned = 0;
  for (const row of rows) {
    if (!inSubtree(row.id)) continue;
    const location = {
      nodeId: row.id,
      nodeType: row.type,
      nodeName: row.name,
      nodeSlug: row.slug,
      path: nodePathOf(byId, visibleIds, row.id),
      updatedAt: row.updatedAt.toISOString(),
    };
    const updatedAtMs = row.updatedAt.getTime();

    if (wantSkills && row.type === "skill") {
      skillsScanned += 1;
      candidates.push({
        item: { kind: "skill", ...location, name: row.name, description: row.description },
        fields: [
          { name: "name", group: "nameOrSlug", texts: [row.name] },
          { name: "slug", group: "nameOrSlug", texts: [row.slug] },
          { name: "description", group: "description", texts: [row.description] },
        ],
        updatedAtMs,
      });
    }

    if (wantPrompts && Array.isArray(row.prompts) && row.prompts.length > 0) {
      // Same validation the Ask Agent dialog applies: a list that fails the
      // schema (a manual jsonb edit, a pre-endpoint write) is skipped whole,
      // never half-rendered and never an error.
      const validated = customAgentPromptsSchema.safeParse(row.prompts);
      if (!validated.success) continue;
      promptNodesScanned += 1;
      for (const prompt of validated.data) {
        candidates.push({
          item: {
            kind: "prompt",
            ...location,
            key: prompt.key,
            label: localized(prompt.label, options.locale),
            intent: prompt.intent ?? "change",
          },
          fields: [
            { name: "label", group: "label", texts: allLocaleValues(prompt.label) },
            { name: "body", group: "body", texts: allLocaleValues(prompt.body) },
          ],
          updatedAtMs,
          bodyPrefix: localized(prompt.body, options.locale),
        });
      }
    }
  }

  return { candidates, byId, visibleIds, skillsScanned, promptNodesScanned };
};

export type PlaybookCandidates = ReturnType<typeof buildPlaybookCandidates>;

/**
 * Every playbook the caller can read, projected into a `Candidate`. Shared by
 * `search` (which scores and ranks them) and `list` (which sorts them by
 * folder), so both apply exactly the same permission, archive, and prompt
 * validation rules — a playbook the list shows is one search can find.
 */
const loadCandidates = async (
  db: Db,
  spaceId: string,
  options: LoadCandidatesOptions,
): Promise<PlaybookCandidates> => {
  const wantSkills = options.kinds.has("skill");
  const wantPrompts = options.kinds.has("prompt");
  const typeCondition = or(
    wantSkills ? eq(busabaseNodes.type, "skill") : undefined,
    wantPrompts ? hasCustomPromptsSql : undefined,
  );

  // ACL in the SQL: a node the caller cannot read is never loaded, so it can
  // neither appear in `items` nor be counted in `total`.
  const rows = await db
    .select({
      id: busabaseNodes.id,
      parentId: busabaseNodes.parentId,
      type: busabaseNodes.type,
      name: busabaseNodes.name,
      slug: busabaseNodes.slug,
      description: busabaseNodes.description,
      updatedAt: busabaseNodes.updatedAt,
      prompts: wantPrompts
        ? promptPreviewSql(PLAYBOOK_SEARCH_LIMITS.bodyPrefixChars)
        : sql<unknown>`null`,
    })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        isNull(busabaseNodes.deletedAt),
        buildNodeVisibilityCondition(db),
        typeCondition,
      ),
    );

  return buildPlaybookCandidates(rows, await loadNodeTree(db, spaceId), options);
};

export const kindSet = (kinds: readonly PlaybookKind[] | undefined): Set<PlaybookKind> =>
  new Set(kinds && kinds.length > 0 ? kinds : ["skill", "prompt"]);

// ── search ────────────────────────────────────────────────────────────────────

/**
 * Score, rank, and cap loaded candidates for one parsed search. Pure: the demo
 * router ranks its seed with exactly this, so "Try it" in the demo behaves like
 * the product.
 */
export const rankPlaybookSearch = (
  parsed: ReturnType<typeof PlaybookSearchInputSchema.parse>,
  loaded: PlaybookCandidates,
): PlaybookSearchResultVO => {
  const queries = normalizeQueries(parsed.queries);
  const browse = queries.length === 0;
  const { candidates, byId, visibleIds, skillsScanned, promptNodesScanned } = loaded;
  const proximity = proximityRanker(
    byId,
    parsed.nearNodeId && (visibleIds === null || visibleIds.has(parsed.nearNodeId))
      ? parsed.nearNodeId
      : undefined,
  );

  const ranked = candidates
    .map((candidate) => {
      const { score, matchedOn } = browse
        ? { score: 0, matchedOn: [] as PlaybookMatchField[] }
        : scoreCandidate(candidate, queries);
      return {
        candidate,
        score,
        matchedOn,
        proximity: proximity(candidate.item.nodeId),
      };
    })
    .filter((entry) => browse || entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.proximity - b.proximity ||
        // Skill before prompt: a skill is the fuller procedure.
        (a.candidate.item.kind === b.candidate.item.kind
          ? 0
          : a.candidate.item.kind === "skill"
            ? -1
            : 1) ||
        b.candidate.updatedAtMs - a.candidate.updatedAtMs,
    );

  const limit = browse
    ? Math.min(
        parsed.limit ?? PLAYBOOK_SEARCH_LIMITS.browseLimit,
        PLAYBOOK_SEARCH_LIMITS.browseLimit,
      )
    : (parsed.limit ?? PLAYBOOK_SEARCH_LIMITS.defaultLimit);
  const items = ranked.slice(0, limit).map(
    ({ candidate, score, matchedOn }): PlaybookSearchItemVO => ({
      ...candidate.item,
      matchedOn,
      score,
    }),
  );

  return {
    items,
    total: ranked.length,
    truncated: ranked.length > items.length,
    coverage: { skillsScanned, promptNodesScanned },
  };
};

export const searchPlaybooks = async (
  input: PlaybookSearchInputDTO,
): Promise<PlaybookSearchResultVO> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const parsed = PlaybookSearchInputSchema.parse(input);
  const loaded = await loadCandidates(db, spaceId, {
    kinds: kindSet(parsed.kinds),
    locale: parsed.locale,
    inNodeId: parsed.inNodeId,
  });
  return rankPlaybookSearch(parsed, loaded);
};

// ── list ──────────────────────────────────────────────────────────────────────

/**
 * One line of a prompt body for a person to skim: the `{target}` placeholder
 * resolved for reading (at run time it expands to a whole sentence naming the
 * node), whitespace collapsed, cut at the preview length with an ellipsis.
 */
const previewOf = (text: string, nodeName: string): string => {
  const flat = text
    // On its own line (the usual "{target}\n\n…" shape) it only says WHERE —
    // the row already names the node — so it is dropped; mid-sentence it is
    // part of the grammar, so it reads as the node's name.
    .replace(/^[ \t]*\{target\}[ \t]*$/gm, "")
    .replaceAll("{target}", nodeName)
    .replace(/\s+/g, " ")
    .trim();
  const max = PLAYBOOK_LIST_LIMITS.bodyPreviewChars;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

/** Folder paths compared segment by segment, so "Sales" sorts before "Sales / Leads". */
const comparePaths = (a: readonly string[], b: readonly string[]): number => {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) {
    const order = (a[index] as string).localeCompare(b[index] as string);
    if (order !== 0) return order;
  }
  return a.length - b.length;
};

const titleOf = (item: Candidate["item"]): string =>
  (item.kind === "skill" ? item.name : item.label) ?? item.nodeName;

// ── usage ─────────────────────────────────────────────────────────────────────

/** Same identity a list row uses: `skill:<nodeId>` / `prompt:<nodeId>:<key>`. */
export const usageKeyOf = (kind: string, nodeId: string, key: string | null | undefined): string =>
  kind === "skill" ? `skill:${nodeId}` : `prompt:${nodeId}:${key ?? ""}`;

/**
 * `source_meta -> 'provenance' -> 'playbook'`, the server-validated playbook
 * `withContextSourceMeta` stamps on every change request written under an
 * `x-busabase-playbook` declaration (spec §11b H1). Raw `sql` because drizzle
 * has no jsonb-path API; `->>` yields text, and a malformed value yields null
 * (then the row is simply not counted).
 */
const playbookPath = (field: "kind" | "nodeId" | "key") =>
  sql<
    string | null
  >`${busabaseChangeRequests.sourceMeta} -> 'provenance' -> 'playbook' ->> ${sql.raw(`'${field}'`)}`;

/**
 * Per-playbook usage in the current space, keyed by `usageKeyOf`.
 *
 * Status: EVERY change request status counts, rejected and abandoned included.
 * The page asks "are agents finding and following this playbook?" — a change
 * that cited it and was then rejected still answers yes; the rejection is a
 * verdict on the change, not on whether the playbook was found.
 *
 * ACL: only change requests the CURRENT viewer can see are counted, by the
 * exact rule the inbox list and its tab badges use (`filterVisibleChangeRequestRows`).
 * Otherwise a count would reveal work on nodes the viewer cannot read ("3 uses"
 * when the inbox shows them one). Like `countChangeRequests`: a space manager
 * sees every change request, so their tally is ONE grouped SQL aggregate; for
 * anyone else visibility depends on each change request's operation scope,
 * which is not a SQL predicate, so only the playbook-attributed rows are read
 * in one query, filtered in bounded batches, and tallied here. No per-playbook
 * query either way.
 *
 * Index: none added. The scan is bounded by `space_id` (served by
 * `busabase_change_requests_space_created_id_idx`) and the jsonb path is
 * evaluated per row of that space; add an expression index only if this is
 * measured to be slow.
 */
const loadPlaybookUsage = async (
  db: Db,
  spaceId: string,
  now: Date = new Date(),
): Promise<Map<string, PlaybookUsageVO>> => {
  const since = new Date(now.getTime() - PLAYBOOK_USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const kind = playbookPath("kind");
  const nodeId = playbookPath("nodeId");
  const key = playbookPath("key");
  const where = and(eq(busabaseChangeRequests.spaceId, spaceId), isNotNull(nodeId));
  const usage = new Map<string, PlaybookUsageVO>();

  if (getContextIsSpaceManager()) {
    const rows = await db
      .select({
        kind,
        nodeId,
        key,
        recent: sql<number>`(count(*) filter (where ${gte(busabaseChangeRequests.createdAt, since)}))::int`,
        lastUsedAt: max(busabaseChangeRequests.createdAt),
      })
      .from(busabaseChangeRequests)
      .where(where)
      .groupBy(kind, nodeId, key);
    for (const row of rows) {
      if (!row.kind || !row.nodeId) continue;
      usage.set(usageKeyOf(row.kind, row.nodeId, row.key), {
        changeRequests30d: Number(row.recent),
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
      });
    }
    return usage;
  }

  const candidates = await db
    .select({
      id: busabaseChangeRequests.id,
      kind,
      nodeId,
      key,
      createdAt: busabaseChangeRequests.createdAt,
    })
    .from(busabaseChangeRequests)
    .where(where);
  for (let offset = 0; offset < candidates.length; offset += CHANGE_REQUEST_ACL_BATCH_SIZE) {
    const visible = await filterVisibleChangeRequestRows(
      candidates.slice(offset, offset + CHANGE_REQUEST_ACL_BATCH_SIZE),
    );
    for (const row of visible) {
      if (!row.kind || !row.nodeId) continue;
      const usageKey = usageKeyOf(row.kind, row.nodeId, row.key);
      const current = usage.get(usageKey) ?? { changeRequests30d: 0, lastUsedAt: null };
      const createdAt = row.createdAt.toISOString();
      usage.set(usageKey, {
        changeRequests30d: current.changeRequests30d + (row.createdAt >= since ? 1 : 0),
        // ISO strings in UTC compare correctly as strings.
        lastUsedAt:
          current.lastUsedAt === null || createdAt > current.lastUsedAt
            ? createdAt
            : current.lastUsedAt,
      });
    }
  }
  return usage;
};

export interface ListPlaybooksOptions {
  /**
   * Attach `usage` to every item (the Playbooks page). Off by default: the MCP
   * prompt/resource listings reuse this catalog and have no use for it.
   */
  withUsage?: boolean;
  /** Clock for the 30-day window; injectable for tests. */
  now?: Date;
}

/**
 * Sort candidates into the catalog and attach usage. Pure: shared by the real
 * store and the demo router.
 */
export const assemblePlaybookList = (
  candidates: PlaybookCandidates["candidates"],
  usage: Map<string, PlaybookUsageVO> | null,
): PlaybookListResultVO => {
  const sorted = [...candidates].sort(
    (a, b) =>
      comparePaths(a.item.path, b.item.path) ||
      (a.item.kind === b.item.kind ? 0 : a.item.kind === "skill" ? -1 : 1) ||
      titleOf(a.item).localeCompare(titleOf(b.item)) ||
      a.item.nodeName.localeCompare(b.item.nodeName) ||
      (a.item.key ?? "").localeCompare(b.item.key ?? ""),
  );

  const items = sorted.slice(0, PLAYBOOK_LIST_LIMITS.maxItems).map(
    ({ item, bodyPrefix }): PlaybookListItemVO => ({
      ...item,
      ...(item.kind === "prompt" && bodyPrefix !== undefined
        ? { bodyPreview: previewOf(bodyPrefix, item.nodeName) }
        : {}),
      ...(usage
        ? {
            usage: usage.get(usageKeyOf(item.kind, item.nodeId, item.key)) ?? {
              changeRequests30d: 0,
              lastUsedAt: null,
            },
          }
        : {}),
    }),
  );
  return { items, total: sorted.length, truncated: sorted.length > items.length };
};

/**
 * The whole catalog for the dashboard's Playbooks page: every skill and custom
 * prompt the caller can read, sorted by folder path, then skills before
 * prompts, then name/label. Unranked on purpose — this answers "what exists?",
 * not "what fits this job?" (that is `searchPlaybooks`).
 */
export const listPlaybooks = async (
  input: PlaybookListInputDTO,
  options: ListPlaybooksOptions = {},
): Promise<PlaybookListResultVO> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const parsed = PlaybookListInputSchema.parse(input ?? {});
  const { candidates } = await loadCandidates(db, spaceId, {
    kinds: kindSet(parsed.kinds),
    locale: parsed.locale,
  });
  const usage = options.withUsage ? await loadPlaybookUsage(db, spaceId, options.now) : null;
  return assemblePlaybookList(candidates, usage);
};

// ── get ───────────────────────────────────────────────────────────────────────

const notFound = (message: string) => new ORPCError("NOT_FOUND", { message });

export const getPlaybook = async (input: PlaybookGetInputDTO): Promise<PlaybookGetVO> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const parsed = PlaybookGetInputSchema.parse(input);

  // A node the caller cannot read is "not found", same as every other node
  // read — its existence is not the caller's business.
  const [node] = await db
    .select({
      id: busabaseNodes.id,
      type: busabaseNodes.type,
      name: busabaseNodes.name,
      slug: busabaseNodes.slug,
      description: busabaseNodes.description,
    })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.id, parsed.nodeId),
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        isNull(busabaseNodes.deletedAt),
        buildNodeVisibilityCondition(db),
      ),
    )
    .limit(1);
  if (!node) throw notFound(`Playbook node not found: ${parsed.nodeId}`);

  const { byId, visibleIds } = await loadNodeTree(db, spaceId);
  const location = {
    kind: parsed.kind,
    nodeId: node.id,
    nodeType: node.type,
    nodeName: node.name,
    nodeSlug: node.slug,
    path: nodePathOf(byId, visibleIds, node.id),
  };

  if (parsed.kind === "skill") {
    if (node.type !== "skill") throw notFound(`Node ${node.id} is not a skill`);
    const files = await listSkillFiles(node.id);
    const hasEntry = files.some((file) => file.path === SKILL_ENTRY_FILE);
    const content = hasEntry ? (await readSkillFile(node.id, SKILL_ENTRY_FILE)).content : "";
    return {
      ...location,
      name: node.name,
      description: node.description,
      content,
      files: files.map((file) => ({ path: file.path, size: file.size, mimeType: file.mimeType })),
    };
  }

  // Prompt: render with the SAME helper the Ask Agent dialog uses, so the CLI,
  // MCP, and the side panel all send byte-identical text.
  const [row] = await db
    .select({ agentPrompts: busabaseNodes.agentPrompts })
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, node.id))
    .limit(1);
  return renderPromptPlaybook(
    { ...location, spaceId, agentPrompts: row?.agentPrompts ?? null },
    parsed,
  );
};

/**
 * One custom prompt of a node, rendered exactly as an agent receives it. Pure:
 * shared by the real store and the demo router, so the demo's prompt text is
 * byte-identical to the product's.
 */
export const renderPromptPlaybook = (
  node: {
    nodeId: string;
    nodeType: string;
    nodeName: string;
    nodeSlug: string;
    path: string[];
    spaceId: string;
    agentPrompts: unknown;
  },
  parsed: ReturnType<typeof PlaybookGetInputSchema.parse>,
): PlaybookGetVO => {
  const validated = customAgentPromptsSchema.safeParse(node.agentPrompts);
  const custom = validated.success ? validated.data : [];
  const definition = custom.find((prompt) => prompt.key === parsed.key);
  if (!definition) throw notFound(`Prompt "${parsed.key}" not found on node ${node.nodeId}`);

  const locale = toCoreLocale(parsed.locale);
  // Without a locale the dashboard speaks (none given, or one it has no catalog for) the body
  // falls back to English — but the agent is talking to the user in THEIR language, so the
  // footer must not order it to reply in English.
  const replyLanguage = isCoreLocale(parsed.locale) ? "locale" : "user";
  const { scenarios } = buildNodeAgentPrompts(
    {
      nodeType: node.nodeType,
      nodeName: node.nodeName,
      nodeId: node.nodeId,
      spaceId: node.spaceId,
      customPrompts: custom,
    },
    locale,
    coreMessagesByLocale[locale],
    { replyLanguage },
  );
  const rendered = scenarios.find(
    (prompt) => prompt.source === "custom-scenario" && prompt.customKey === parsed.key,
  );
  if (!rendered) throw notFound(`Prompt "${parsed.key}" not found on node ${node.nodeId}`);

  return {
    kind: "prompt",
    nodeId: node.nodeId,
    nodeType: node.nodeType,
    nodeName: node.nodeName,
    nodeSlug: node.nodeSlug,
    path: node.path,
    key: definition.key,
    label: rendered.label,
    intent: definition.intent ?? "change",
    locale,
    content: rendered.body,
  };
};
