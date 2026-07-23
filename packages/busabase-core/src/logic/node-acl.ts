import "server-only";

import { ORPCError } from "@orpc/server";
import {
  API_KEY_LEVEL_ORDER,
  type ApiKeyPermissionLevel,
  hasApiKeyLevel,
} from "busabase-contract/access-control/api-key-level";
import type { AnyColumn } from "drizzle-orm";
import { and, eq, exists, inArray, isNotNull, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import {
  getContextActorId,
  getContextIsSpaceManager,
  getContextPermissionLevel,
  getContextRestrictedVisibility,
  getContextSpaceId,
  isAnonymousVisitor,
  resolveActorId,
} from "../context";
import { getDb } from "../db";
import { busabaseNodePrincipals, busabaseNodes } from "../db/schema";
import { busabaseBases } from "../domains/base/schema";
import { id, now, rootNodeIdForSpace } from "./kernel";

/**
 * Node-level access control (see `busabase_node_principals` in db/schema.ts
 * for the model). Everything here is auth-agnostic: "who is a manager" and
 * "is this space restricted" arrive as host-injected context booleans
 * (`isSpaceManager` / `restrictedVisibility`); the open-source single-user
 * host injects neither and every check short-circuits to full access.
 *
 * Visibility semantics (`busabaseNodes.effectiveVisibility`, materialized):
 * - `private`             → only managers + granted principals
 * - `workspace` / `public`→ every space member (public == workspace in v1:
 *                           there is no anonymous surface yet)
 * - NULL (nothing explicit anywhere in the ancestor chain)
 *                         → follows the space default: visible in open mode,
 *                           hidden like private in restricted mode
 */

export type NodeVisibility = "private" | "workspace" | "public";

/** Workspace-wide mutation gate shared by CR lifecycle and direct writes. */
export function assertWorkspacePermission(required: ApiKeyPermissionLevel): void {
  const level = getContextPermissionLevel();
  if (!hasApiKeyLevel(level, required)) {
    throw new ORPCError("FORBIDDEN", {
      message: `Requires ${required} workspace access`,
      data: { required, level },
    });
  }
}

const STRICTNESS: Record<NodeVisibility, number> = { private: 0, workspace: 1, public: 2 };

/**
 * The materialized public-share capability on one node, or null when it isn't
 * publicly reachable. Single-column read: the ancestor walk happened at write
 * time in `recomputeEffectivePublicScope`.
 */
export async function getPublicScopeOf(nodeId: string): Promise<"read" | "submit" | null> {
  const db = await getDb();
  const [row] = await db
    .select({ scope: busabaseNodes.effectivePublicScope })
    .from(busabaseNodes)
    .where(and(eq(busabaseNodes.id, nodeId), eq(busabaseNodes.spaceId, getContextSpaceId())))
    .limit(1);
  return row?.scope ?? null;
}

/** The stricter of two explicit visibilities; null = "no explicit constraint". */
const strictest = (
  a: NodeVisibility | null | undefined,
  b: NodeVisibility | null | undefined,
): NodeVisibility | null => {
  if (!a) return b ?? null;
  if (!b) return a;
  return STRICTNESS[a] <= STRICTNESS[b] ? a : b;
};

const KNOWN_VISIBILITIES = new Set<string>(["private", "workspace", "public"]);

const explicitVisibilityOf = (metadata: unknown): NodeVisibility | null => {
  const value = (metadata as { visibility?: unknown } | null | undefined)?.visibility;
  return typeof value === "string" && KNOWN_VISIBILITIES.has(value)
    ? (value as NodeVisibility)
    : null;
};

// ── Read-side: SQL fragment + per-node checks ────────────────────────────────

/**
 * Visibility condition for list/search/grep queries, correlated on
 * `busabaseNodes.id` — the outer query must select FROM (or JOIN) the
 * `busabaseNodes` table. Returns `undefined` for managers (no restriction),
 * so callers can spread it into an existing `and(...)` unconditionally.
 *
 * The grant check is one EXISTS over `busabase_node_principals`; inherited
 * (folder-level) grants are already materialized as per-descendant rows by
 * `recomputeSpaceNodeAcl`, so no ancestor walk happens here.
 */
export const buildNodeVisibilityCondition = (
  db: Awaited<ReturnType<typeof getDb>>,
  inputActorId?: string,
): SQL | undefined => {
  // An anonymous visitor is not a space member, so NONE of the member-facing
  // rules below apply to them: `workspace`/`public` visibility means "every
  // member", and `principalType: "space"` grants mean "everyone in the space".
  // Their only way in is an explicit public share, materialized onto
  // `effectivePublicScope` (see logic/node-share.ts).
  if (isAnonymousVisitor()) {
    return isNotNull(busabaseNodes.effectivePublicScope);
  }
  if (getContextIsSpaceManager()) return undefined;
  const actorId = resolveActorId(inputActorId ?? "local-user");

  const grantExists = exists(
    db
      .select({ one: sql`1` })
      .from(busabaseNodePrincipals)
      .where(
        and(
          eq(busabaseNodePrincipals.nodeId, busabaseNodes.id),
          or(
            and(
              eq(busabaseNodePrincipals.principalType, "user"),
              eq(busabaseNodePrincipals.principalId, actorId),
            ),
            eq(busabaseNodePrincipals.principalType, "space"),
          ),
        ),
      ),
  );

  // Open mode: anything not explicitly private (incl. NULL) is member-visible.
  // Restricted mode: only explicitly-opened (workspace/public) nodes are.
  const defaultVisible = getContextRestrictedVisibility()
    ? inArray(busabaseNodes.effectiveVisibility, ["workspace", "public"])
    : or(
        isNull(busabaseNodes.effectiveVisibility),
        ne(busabaseNodes.effectiveVisibility, "private"),
      );

  return or(defaultVisible, grantExists);
};

/**
 * Same visibility test, but for outer queries that do NOT select from
 * `busabaseNodes` themselves — correlates a nested EXISTS over the nodes
 * table on the given node-id column (e.g. `busabaseBases.nodeId`).
 */
export const buildNodeVisibilityExists = (
  db: Awaited<ReturnType<typeof getDb>>,
  nodeIdColumn: AnyColumn,
  inputActorId?: string,
): SQL | undefined => {
  const condition = buildNodeVisibilityCondition(db, inputActorId);
  if (!condition) return undefined;
  return exists(
    db
      .select({ one: sql`1` })
      .from(busabaseNodes)
      .where(and(eq(busabaseNodes.id, nodeIdColumn), condition)),
  );
};

/**
 * Visibility test for record/field-value queries whose outer table only has a
 * `baseId` — nests bases → nodes so callers don't each hand-write the join.
 */
export const buildBaseVisibilityExists = (
  db: Awaited<ReturnType<typeof getDb>>,
  baseIdColumn: AnyColumn,
  inputActorId?: string,
): SQL | undefined => {
  const condition = buildNodeVisibilityCondition(db, inputActorId);
  if (!condition) return undefined;
  return exists(
    db
      .select({ one: sql`1` })
      .from(busabaseBases)
      .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseBases.nodeId))
      .where(and(eq(busabaseBases.id, baseIdColumn), condition)),
  );
};

/**
 * The actor's effective permission level on one node, or null when the node
 * is invisible to them (callers translate null → NOT_FOUND so an
 * unauthorized probe can't distinguish "hidden" from "doesn't exist").
 * Baseline: any default-visible node grants `read`; explicit principal rows
 * (direct or materialized-inherited) can raise it up to `manage`.
 */
export async function getEffectiveNodeLevel(
  nodeId: string,
  inputActorId?: string,
): Promise<ApiKeyPermissionLevel | null> {
  // See buildNodeVisibilityCondition. An anonymous visitor never picks up the
  // member-facing baseline (that path would hand them `read` on every
  // workspace-visible node); they get exactly what the node's public share
  // grants, and `read` for either share capability — `submit` means "may open a
  // ChangeRequest", which the submit path authorizes separately, not a higher
  // read level.
  if (isAnonymousVisitor()) {
    return (await getPublicScopeOf(nodeId)) ? "read" : null;
  }
  if (getContextIsSpaceManager()) return "manage";
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const actorId = resolveActorId(inputActorId ?? "local-user");

  const [node] = await db
    .select({ effectiveVisibility: busabaseNodes.effectiveVisibility })
    .from(busabaseNodes)
    .where(and(eq(busabaseNodes.id, nodeId), eq(busabaseNodes.spaceId, spaceId)))
    .limit(1);
  if (!node) return null;

  const grants = await db
    .select({ role: busabaseNodePrincipals.role })
    .from(busabaseNodePrincipals)
    .where(
      and(
        eq(busabaseNodePrincipals.nodeId, nodeId),
        or(
          and(
            eq(busabaseNodePrincipals.principalType, "user"),
            eq(busabaseNodePrincipals.principalId, actorId),
          ),
          eq(busabaseNodePrincipals.principalType, "space"),
        ),
      ),
    );

  const defaultVisible = getContextRestrictedVisibility()
    ? node.effectiveVisibility === "workspace" || node.effectiveVisibility === "public"
    : node.effectiveVisibility !== "private";

  let level: ApiKeyPermissionLevel | null = defaultVisible ? getContextPermissionLevel() : null;
  for (const grant of grants) {
    if (!level || API_KEY_LEVEL_ORDER[grant.role] > API_KEY_LEVEL_ORDER[level]) {
      level = grant.role;
    }
  }
  return level;
}

/** Read gate: NOT_FOUND (never FORBIDDEN) when the actor can't see the node. */
export async function assertNodeVisible(nodeId: string, inputActorId?: string): Promise<void> {
  const level = await getEffectiveNodeLevel(nodeId, inputActorId);
  if (level === null) {
    throw new ORPCError("NOT_FOUND", { message: `Node not found: ${nodeId}` });
  }
}

/**
 * Operation gate. Invisible → NOT_FOUND (same as assertNodeVisible); visible
 * but below the required level → FORBIDDEN (no point hiding a node the actor
 * can already see).
 */
export async function assertNodePermission(
  nodeId: string,
  required: ApiKeyPermissionLevel,
  inputActorId?: string,
): Promise<void> {
  const level = await getEffectiveNodeLevel(nodeId, inputActorId);
  if (level === null) {
    throw new ORPCError("NOT_FOUND", { message: `Node not found: ${nodeId}` });
  }
  if (!hasApiKeyLevel(level, required)) {
    throw new ORPCError("FORBIDDEN", {
      message: `Requires ${required} access on this node`,
      data: { nodeId, required, level },
    });
  }
}

/**
 * Non-throwing sibling of `assertNodePermission`, for callers that need to
 * make a decision (not just gate an action) based on whether an actor has a
 * level — e.g. resolving a permission-aware `autoMerge` default. An
 * invisible node (null level) always resolves to `false`, same as it would
 * fail `assertNodePermission`.
 */
export async function hasNodePermission(
  nodeId: string,
  required: ApiKeyPermissionLevel,
  inputActorId?: string,
): Promise<boolean> {
  const level = await getEffectiveNodeLevel(nodeId, inputActorId);
  return level !== null && hasApiKeyLevel(level, required);
}

/**
 * Resolves whether a create-CR call should merge immediately vs. create a
 * pending CR, given the caller's `autoMerge` request and whether they hold
 * `write` on the target node(s):
 *  - `autoMerge: false` (explicit) always forces a CR, even for an actor who
 *    could write directly — the deliberate "review me anyway" override.
 *  - `autoMerge: true` or omitted (`undefined`) merges immediately IF the
 *    actor has `write`; otherwise gracefully falls back to a CR (no
 *    FORBIDDEN — the caller just gets a pending CR instead of what they may
 *    have asked for).
 */
export function shouldAutoMerge(
  requestedAutoMerge: boolean | undefined,
  hasWritePermission: boolean,
): boolean {
  return requestedAutoMerge !== false && hasWritePermission;
}

/**
 * ChangeRequest-submission gate for record/base-targeted proposals: resolves
 * the base's node and requires `changeRequest` level on it. Accepts a base id
 * or slug (mirroring getBase's lookup order). Managers short-circuit before
 * any query.
 */
export async function assertBaseChangeRequestPermission(
  baseIdOrSlug: string,
  inputActorId?: string,
): Promise<void> {
  if (getContextIsSpaceManager()) return;
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const [base] = await db
    .select({ nodeId: busabaseBases.nodeId })
    .from(busabaseBases)
    .where(and(eq(busabaseBases.id, baseIdOrSlug), eq(busabaseBases.spaceId, spaceId)))
    .limit(1);
  const [resolved] = base
    ? [base]
    : await db
        .select({ nodeId: busabaseBases.nodeId })
        .from(busabaseBases)
        .where(and(eq(busabaseBases.slug, baseIdOrSlug), eq(busabaseBases.spaceId, spaceId)))
        .limit(1);
  if (!resolved) {
    throw new ORPCError("NOT_FOUND", { message: `Base not found: ${baseIdOrSlug}` });
  }
  await assertNodePermission(resolved.nodeId, "changeRequest", inputActorId);
}

// ── Write-side: materialization ──────────────────────────────────────────────

/**
 * Rebuild BOTH materialized ACL artifacts for a whole space in one pass:
 *  - `busabaseNodes.effectiveVisibility` (strictest explicit visibility along
 *    each node's ancestor chain, NULL when nothing explicit anywhere), and
 *  - inherited principal rows (each direct grant, `sourceNodeId === nodeId`,
 *    is copied to every descendant with the same `sourceNodeId`).
 *
 * Called after any write that changes the tree shape or the ACL inputs:
 * node create, node move, visibility change, grant add/remove, CR merge that
 * materializes nodes. Whole-space (not subtree-scoped) on purpose — spaces
 * are small, `buildNodeTree` already loads them wholesale, and one code path
 * with no scoping edge cases beats a faster one that misses a move corner.
 */
export async function recomputeSpaceNodeAcl(
  db?: Awaited<ReturnType<typeof getDb>>,
  spaceIdInput?: string,
): Promise<void> {
  const database = db ?? (await getDb());
  const spaceId = spaceIdInput ?? getContextSpaceId();

  const nodes = await database
    .select({
      id: busabaseNodes.id,
      parentId: busabaseNodes.parentId,
      metadata: busabaseNodes.metadata,
      effectiveVisibility: busabaseNodes.effectiveVisibility,
    })
    .from(busabaseNodes)
    .where(eq(busabaseNodes.spaceId, spaceId));
  if (nodes.length === 0) return;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string | null, string[]>();
  for (const node of nodes) {
    // Treat a parent outside this space's node set as a root.
    const parentKey = node.parentId && byId.has(node.parentId) ? node.parentId : null;
    const siblings = childrenOf.get(parentKey) ?? [];
    siblings.push(node.id);
    childrenOf.set(parentKey, siblings);
  }

  // 1. effectiveVisibility: BFS from the roots, folding the chain's strictest
  //    explicit visibility downward.
  const computedVisibility = new Map<string, NodeVisibility | null>();
  const queue = (childrenOf.get(null) ?? []).map((nodeId) => ({
    nodeId,
    parentEffective: null as NodeVisibility | null,
  }));
  while (queue.length > 0) {
    const { nodeId, parentEffective } = queue.shift()!;
    const node = byId.get(nodeId)!;
    const effective = strictest(parentEffective, explicitVisibilityOf(node.metadata));
    computedVisibility.set(nodeId, effective);
    for (const childId of childrenOf.get(nodeId) ?? []) {
      queue.push({ nodeId: childId, parentEffective: effective });
    }
  }
  for (const node of nodes) {
    const computed = computedVisibility.get(node.id) ?? null;
    if ((node.effectiveVisibility ?? null) !== computed) {
      await database
        .update(busabaseNodes)
        .set({ effectiveVisibility: computed })
        .where(eq(busabaseNodes.id, node.id));
    }
  }

  // 2. Inherited principal rows: direct grants (sourceNodeId === nodeId) are
  //    the source of truth; the correct inherited set for each node is the
  //    union of its ancestors' direct grants. Diff against what's stored.
  const principalRows = await database
    .select()
    .from(busabaseNodePrincipals)
    .where(eq(busabaseNodePrincipals.spaceId, spaceId));

  const directBySource = new Map<string, typeof principalRows>();
  for (const row of principalRows) {
    if (row.sourceNodeId === row.nodeId) {
      const rows = directBySource.get(row.sourceNodeId) ?? [];
      rows.push(row);
      directBySource.set(row.sourceNodeId, rows);
    }
  }

  const wantKey = (
    nodeId: string,
    row: { principalType: string; principalId: string; sourceNodeId: string },
  ) => `${nodeId} ${row.principalType} ${row.principalId} ${row.sourceNodeId}`;

  // Desired inherited rows: walk each direct grant's source subtree.
  const desired = new Map<string, { nodeId: string; source: (typeof principalRows)[number] }>();
  for (const [sourceNodeId, rows] of directBySource) {
    const stack = [...(childrenOf.get(sourceNodeId) ?? [])];
    while (stack.length > 0) {
      const nodeId = stack.pop()!;
      for (const row of rows) {
        desired.set(wantKey(nodeId, row), { nodeId, source: row });
      }
      stack.push(...(childrenOf.get(nodeId) ?? []));
    }
  }

  const existingInherited = new Map<string, (typeof principalRows)[number]>();
  for (const row of principalRows) {
    if (row.sourceNodeId !== row.nodeId) {
      existingInherited.set(wantKey(row.nodeId, row), row);
    }
  }

  const staleIds = [...existingInherited.entries()]
    .filter(([key, row]) => {
      const want = desired.get(key);
      return !want || want.source.role !== row.role;
    })
    .map(([, row]) => row.id);
  if (staleIds.length > 0) {
    await database
      .delete(busabaseNodePrincipals)
      .where(inArray(busabaseNodePrincipals.id, staleIds));
  }

  const timestamp = now();
  const inserts = [...desired.entries()]
    .filter(([key]) => {
      const existing = existingInherited.get(key);
      return !existing || existing.role !== desired.get(key)!.source.role;
    })
    .map(([, { nodeId, source }]) => ({
      id: id("nap"),
      spaceId,
      nodeId,
      sourceNodeId: source.sourceNodeId,
      principalType: source.principalType,
      principalId: source.principalId,
      role: source.role,
      grantedBy: source.grantedBy,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
  if (inserts.length > 0) {
    await database.insert(busabaseNodePrincipals).values(inserts);
  }
}

// ── Grant / visibility management (called from the router) ───────────────────

export interface NodePrincipalInput {
  principalType: "user" | "space";
  principalId: string;
  role: ApiKeyPermissionLevel;
}

/** Upsert one direct grant (same principal twice = role update), then re-materialize. */
export async function grantNodePrincipal(
  nodeId: string,
  input: NodePrincipalInput,
  grantedBy: string,
): Promise<void> {
  await assertNodePermission(nodeId, "manage", grantedBy);
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const timestamp = now();

  const [existing] = await db
    .select({ id: busabaseNodePrincipals.id })
    .from(busabaseNodePrincipals)
    .where(
      and(
        eq(busabaseNodePrincipals.nodeId, nodeId),
        eq(busabaseNodePrincipals.sourceNodeId, nodeId),
        eq(busabaseNodePrincipals.principalType, input.principalType),
        eq(busabaseNodePrincipals.principalId, input.principalId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(busabaseNodePrincipals)
      .set({ role: input.role, grantedBy, updatedAt: timestamp })
      .where(eq(busabaseNodePrincipals.id, existing.id));
  } else {
    await db.insert(busabaseNodePrincipals).values({
      id: id("nap"),
      spaceId,
      nodeId,
      sourceNodeId: nodeId,
      principalType: input.principalType,
      principalId: input.principalId,
      role: input.role,
      grantedBy,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  await recomputeSpaceNodeAcl(db, spaceId);
}

/** Remove one direct grant (and its materialized descendants via recompute). */
export async function revokeNodePrincipal(
  nodeId: string,
  principalType: "user" | "space",
  principalId: string,
  actorId: string,
): Promise<void> {
  await assertNodePermission(nodeId, "manage", actorId);
  const db = await getDb();
  await db
    .delete(busabaseNodePrincipals)
    .where(
      and(
        eq(busabaseNodePrincipals.nodeId, nodeId),
        eq(busabaseNodePrincipals.sourceNodeId, nodeId),
        eq(busabaseNodePrincipals.principalType, principalType),
        eq(busabaseNodePrincipals.principalId, principalId),
      ),
    );
  await recomputeSpaceNodeAcl(db, getContextSpaceId());
}

/** Direct grants defined on this node (inherited copies are not listed). */
export async function listNodePrincipals(nodeId: string, actorId: string) {
  await assertNodeVisible(nodeId, actorId);
  const db = await getDb();
  return db
    .select()
    .from(busabaseNodePrincipals)
    .where(
      and(
        eq(busabaseNodePrincipals.nodeId, nodeId),
        eq(busabaseNodePrincipals.sourceNodeId, nodeId),
      ),
    );
}

/**
 * Set a node's own explicit visibility (stored in metadata.visibility), then
 * re-materialize the space. The space root cannot be made private — that
 * would blank the whole workspace for every non-manager.
 */
export async function updateNodeVisibility(
  nodeId: string,
  visibility: NodeVisibility | null,
  actorId: string,
): Promise<void> {
  await assertNodePermission(nodeId, "manage", actorId);
  const db = await getDb();
  const spaceId = getContextSpaceId();

  if (visibility === "private" && nodeId === rootNodeIdForSpace(spaceId)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The workspace root cannot be made private",
    });
  }

  const [node] = await db
    .select({ metadata: busabaseNodes.metadata })
    .from(busabaseNodes)
    .where(and(eq(busabaseNodes.id, nodeId), eq(busabaseNodes.spaceId, spaceId)))
    .limit(1);
  if (!node) {
    throw new ORPCError("NOT_FOUND", { message: `Node not found: ${nodeId}` });
  }

  const metadata = { ...(node.metadata ?? {}) } as Record<string, unknown>;
  if (visibility === null) {
    delete metadata.visibility;
  } else {
    metadata.visibility = visibility;
  }
  await db
    .update(busabaseNodes)
    .set({ metadata: metadata as typeof node.metadata, updatedAt: now() })
    .where(eq(busabaseNodes.id, nodeId));

  await recomputeSpaceNodeAcl(db, spaceId);
}

/**
 * Auto-grant `manage` to a node's creator (called from node-materialization
 * write paths). Without this, a member in a restricted-mode space couldn't
 * even see the node they just created. No-op when the creator is a local
 * sentinel actor (open-source mode has no enforcement anyway).
 */
export async function grantCreatorManage(
  db: Awaited<ReturnType<typeof getDb>>,
  spaceId: string,
  nodeId: string,
  creatorId: string,
): Promise<void> {
  const timestamp = now();
  await db
    .insert(busabaseNodePrincipals)
    .values({
      id: id("nap"),
      spaceId,
      nodeId,
      sourceNodeId: nodeId,
      principalType: "user",
      principalId: creatorId,
      role: "manage",
      grantedBy: creatorId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing();
}

/**
 * One-shot ACL init for a freshly-inserted node — the O(parent-grants)
 * create-path fast lane (a full `recomputeSpaceNodeAcl` is only needed for
 * shape changes like move/visibility edits):
 *  1. effectiveVisibility := strictest(parent's materialized value, own
 *     explicit metadata.visibility) — associative, so the parent's column is
 *     all the ancestor knowledge needed.
 *  2. Copy the parent's principal rows (direct AND inherited, keeping each
 *     row's sourceNodeId) so folder grants keep flowing down.
 *  3. Creator auto-grant (`manage`) — only when a host-authenticated actor
 *     exists (cloud); open-source local mode skips it (no enforcement there,
 *     and seeding grant rows for sentinel actors would be noise).
 */
export async function initializeNodeAcl(
  db: Awaited<ReturnType<typeof getDb>>,
  spaceId: string,
  nodeId: string,
  parentId: string | null,
  creatorId: string,
): Promise<void> {
  const [self] = await db
    .select({ metadata: busabaseNodes.metadata })
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, nodeId))
    .limit(1);
  if (!self) return;

  let parentEffective: NodeVisibility | null = null;
  if (parentId) {
    const [parent] = await db
      .select({ effectiveVisibility: busabaseNodes.effectiveVisibility })
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, parentId))
      .limit(1);
    parentEffective = parent?.effectiveVisibility ?? null;
  }
  const effective = strictest(parentEffective, explicitVisibilityOf(self.metadata));
  if (effective !== null) {
    await db
      .update(busabaseNodes)
      .set({ effectiveVisibility: effective })
      .where(eq(busabaseNodes.id, nodeId));
  }

  if (parentId) {
    const parentRows = await db
      .select()
      .from(busabaseNodePrincipals)
      .where(eq(busabaseNodePrincipals.nodeId, parentId));
    if (parentRows.length > 0) {
      const timestamp = now();
      await db
        .insert(busabaseNodePrincipals)
        .values(
          parentRows.map((row) => ({
            id: id("nap"),
            spaceId,
            nodeId,
            sourceNodeId: row.sourceNodeId,
            principalType: row.principalType,
            principalId: row.principalId,
            role: row.role,
            grantedBy: row.grantedBy,
            createdAt: timestamp,
            updatedAt: timestamp,
          })),
        )
        .onConflictDoNothing();
    }
  }

  if (getContextActorId()) {
    await grantCreatorManage(db, spaceId, nodeId, creatorId);
  }
}
