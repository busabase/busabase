import "server-only";

import {
  type AnyColumn,
  and,
  eq,
  exists,
  isNull,
  not,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getContextIsSpaceManager, getContextSpaceId, isAnonymousVisitor } from "../context";
import type { getDb } from "../db";
import {
  busabaseBases,
  busabaseChangeRequests,
  busabaseCommits,
  busabaseNodes,
  busabaseOperations,
  busabaseRecords,
} from "../db/schema";
import { rootNodeIdForSpace } from "./kernel";
import { buildNodeVisibilityCondition } from "./node-acl";

/**
 * SQL twins of the per-row access checks that the busy lists used to run in JS.
 *
 * Every list here (inbox, inbox badges, change request pages, activity, audit)
 * used to read rows and then decide, row by row, whether the caller may see
 * them: a whole-space read for the badges, or keyset/OFFSET walks that, for a
 * member who can see little, crossed most of the table before a page filled.
 * These builders express the same decisions as SQL predicates so PostgreSQL
 * only returns rows the caller can see.
 *
 * They are twins, not replacements: each predicate is written against one JS
 * check and must agree with it exactly, for every kind of caller. The one case
 * SQL cannot decide is a change request with an operation that names neither a
 * node nor a Base (a pending node create): its scope comes from the head
 * commit's `parentNodeId` / `parentNodeRef` / `ref`, in operation order. Such
 * rows are returned with `needsScopeCheck` set, and the caller runs the
 * original JS check on them — so the result is exact by construction:
 *
 *   visible = {rows the predicate accepts and does not flag}
 *           ∪ JS-check({rows the predicate flags})
 *
 * which holds because the predicate only rejects a row when an operation the
 * JS resolver would also have rejected exists (a scope node the caller cannot
 * reach, a Base outside the space, or no operation at all).
 */

type Db = Awaited<ReturnType<typeof getDb>>;
type Ref = AnyColumn | SQL;

/**
 * Which JS check a predicate stands in for — they differ on purpose:
 *
 * - `list`: `filterVisibleChangeRequestRows` (inbox, badges, CR pages, audit
 *   rows that name a change request). A space manager sees every row; for
 *   everyone else a node counts when it is in this space and passes
 *   `buildNodeVisibilityCondition`, and the workspace root always counts for
 *   a non-anonymous caller.
 * - `permission`: `assertAuditSubjectPermission(_, "read")` /
 *   `assertNodePermission(_, "read")` (activity, audit rows without a change
 *   request). `getEffectiveNodeLevel` is non-null: the node must exist in this
 *   space — for a manager too, so a manager does not see a change request
 *   whose node was purged — then managers need nothing more, members need the
 *   root or the visibility condition, anonymous visitors need a public share.
 */
export type AclMode = "list" | "permission";

const one = sql`1`;

/**
 * How the per-row lookups (change request, operation, commit, record, Base by
 * id) should run:
 *
 * - `scan`: let PostgreSQL turn them into hashed sets and semi/anti-joins. Right
 *   when every row of the space is examined anyway — badges, inbox totals, a
 *   sort no index provides.
 * - `probe`: one index lookup per examined row. Right when an index walk stops
 *   after a page (audit list, keyset pages): with `scan` the planner hashes
 *   every change request and operation of the space before answering for the
 *   first 50 rows. `OFFSET 0` is the standard fence: an EXISTS with an OFFSET
 *   is never turned into a hashed subplan or a join.
 *
 * The reachable-node set is small and stays hashed in both.
 */
export type AclPlan = "scan" | "probe";

// Hand-written rather than `.offset(0)`: drizzle drops a zero offset, and the
// fence has to sit inside the EXISTS, after the parenthesised subquery.
const existsFor = (plan: AclPlan, query: SQLWrapper): SQL =>
  plan === "probe" ? sql`exists (${query} offset 0)` : exists(query);

/**
 * True when the node id `nodeId` is reachable for the caller under `mode`.
 *
 * Written as membership in the (small) set of reachable node ids rather than a
 * correlated EXISTS per row: PostgreSQL hashes the set once, so checking 70,000
 * operations costs 70,000 hash probes instead of 70,000 index lookups each with
 * its own grant subquery. Node ids are never NULL, so `IN` has no NULL trap.
 */
const nodeReachable = (db: Db, nodeId: Ref, mode: AclMode): SQL => {
  const spaceId = getContextSpaceId();
  const rootId = rootNodeIdForSpace(spaceId);
  const inNodes = (extra?: SQL) =>
    sql`${nodeId} in (${db
      .select({ id: busabaseNodes.id })
      .from(busabaseNodes)
      .where(and(eq(busabaseNodes.spaceId, spaceId), extra))})`;
  if (mode === "permission" && getContextIsSpaceManager()) return inNodes();
  // `buildNodeVisibilityCondition` correlates on the unaliased `busabase_nodes`,
  // which is the table `inNodes` selects from.
  const condition = buildNodeVisibilityCondition(db);
  if (isAnonymousVisitor()) return inNodes(condition);
  if (mode === "permission") return inNodes(or(eq(busabaseNodes.id, rootId), condition));
  // `filterVisibleChangeRequestRows` adds the root id itself, row or no row.
  return or(sql`${nodeId} = ${rootId}`, inNodes(condition)) as SQL;
};

export interface ChangeRequestAclSql {
  /**
   * Rows the caller may see. Exact when `needsScopeCheck` is false; otherwise
   * a necessary condition only (every row the JS check accepts passes it), so
   * it can always be the WHERE and flagged rows are decided afterwards.
   */
  visible: SQL;
  /** The row has an operation only the JS scope resolver can place. */
  needsScopeCheck: SQL;
}

/**
 * Visibility of the change request whose id is `changeRequestId` (a column of
 * the outer query, e.g. `busabaseChangeRequests.id` or
 * `busabaseOperations.changeRequestId`).
 *
 * Mirrors `loadChangeRequestScopes` + the node check: the scope is every
 * operation's node, or its Base's node (a Base outside this space leaves the
 * scope unresolved); a change request with no operation has no scope. In
 * `permission` mode the change request row itself must be in this space, as
 * `resolveChangeRequestScopeNodeIds` requires.
 *
 * Returns null in `list` mode for a space manager: every row is visible.
 */
export const buildChangeRequestAclSql = (
  db: Db,
  changeRequestId: Ref,
  mode: AclMode,
  plan: AclPlan = "scan",
): ChangeRequestAclSql | null => {
  if (mode === "list" && getContextIsSpaceManager()) return null;
  const spaceId = getContextSpaceId();
  // Aliased so the subqueries never capture an outer `busabase_operations` /
  // `busabase_bases` (the activity feed's operation source is one).
  const operation = alias(busabaseOperations, "acl_operation");
  const base = alias(busabaseBases, "acl_operation_base");
  const operationsOf = (extra?: SQL) =>
    existsFor(
      plan,
      db
        .select({ one })
        .from(operation)
        .where(
          and(
            eq(operation.spaceId, spaceId),
            eq(operation.changeRequestId, changeRequestId),
            extra,
          ),
        ),
    );
  const scopeNodeId = sql`coalesce(${operation.nodeId}, ${base.nodeId})`;
  const blockedOperation = existsFor(
    plan,
    db
      .select({ one })
      .from(operation)
      .leftJoin(
        base,
        and(isNull(operation.nodeId), eq(base.id, operation.baseId), eq(base.spaceId, spaceId)),
      )
      .where(
        and(
          eq(operation.spaceId, spaceId),
          eq(operation.changeRequestId, changeRequestId),
          // Operations that name a node or a Base; the rest are flagged below.
          sql`(${operation.nodeId} is not null or ${operation.baseId} is not null)`,
          or(isNull(scopeNodeId), not(nodeReachable(db, scopeNodeId, mode))),
        ),
      ),
  );
  return {
    visible: and(
      mode === "permission" ? changeRequestInSpace(db, changeRequestId, plan) : undefined,
      operationsOf(),
      not(blockedOperation),
    ) as SQL,
    needsScopeCheck: operationsOf(and(isNull(operation.nodeId), isNull(operation.baseId))),
  };
};

/** The change request row exists in this space. */
const changeRequestInSpace = (db: Db, changeRequestId: Ref, plan: AclPlan): SQL => {
  const changeRequest = alias(busabaseChangeRequests, "acl_change_request");
  return existsFor(
    plan,
    db
      .select({ one })
      .from(changeRequest)
      .where(
        and(eq(changeRequest.id, changeRequestId), eq(changeRequest.spaceId, getContextSpaceId())),
      ),
  );
};

/** `assertAuditSubjectPermission`'s record branch: record → its Base → node. */
const recordReachable = (db: Db, recordId: Ref, plan: AclPlan): SQL => {
  const record = alias(busabaseRecords, "acl_record");
  const base = alias(busabaseBases, "acl_record_base");
  // The JS join to the Base is not space-scoped; only the record is, and the
  // node check below scopes the node.
  return existsFor(
    plan,
    db
      .select({ one })
      .from(record)
      .innerJoin(base, eq(base.id, record.baseId))
      .where(
        and(
          eq(record.id, recordId),
          eq(record.spaceId, getContextSpaceId()),
          nodeReachable(db, base.nodeId, "permission"),
        ),
      ),
  );
};

/** `assertAuditSubjectPermission`'s Base branch. */
const baseReachable = (db: Db, baseId: Ref, plan: AclPlan): SQL => {
  const base = alias(busabaseBases, "acl_subject_base");
  return existsFor(
    plan,
    db
      .select({ one })
      .from(base)
      .where(
        and(
          eq(base.id, baseId),
          eq(base.spaceId, getContextSpaceId()),
          nodeReachable(db, base.nodeId, "permission"),
        ),
      ),
  );
};

/** JS truthiness of an id column: null and '' are both "absent". */
const present = (column: Ref): SQL => sql`coalesce(${column}, '') <> ''`;

/** A constant SQL boolean, so CASE branches stay boolean-typed. */
const bool = (value: boolean): SQL => (value ? sql`true` : sql`false`);

/** `case when … then … else … end` over boolean branches. */
const caseWhen = (branches: [SQL, SQL][], otherwise: SQL): SQL =>
  sql`(case ${sql.join(
    branches.map(([when, then]) => sql`when ${when} then ${then}`),
    sql` `,
  )} else ${otherwise} end)`;

export interface AuditSubjectColumns {
  baseId: Ref;
  recordId: Ref;
  changeRequestId: Ref;
  operationId: Ref;
  commitId: Ref;
}

export interface AuditSubjectAclSql {
  /** As {@link ChangeRequestAclSql.visible}: exact unless flagged, never too strict. */
  visible: SQL;
  needsScopeCheck: SQL;
}

/**
 * `assertAuditSubjectPermission(subject, "read")` as SQL, branch for branch:
 * no subject → managers only; a change request → its scope; an operation (or
 * else a commit) → its owning change request, falling back to the record when
 * there is no such operation and the subject names a record; a record → its
 * Base's node; a Base → its node.
 *
 * `changeRequestMode` picks the rule for subjects that name a change request:
 * `permission` is `assertAuditSubjectPermission` itself (the activity feed);
 * `list` is the audit list, which checks those through
 * `filterVisibleChangeRequestRows` on rows of this space instead.
 */
export const buildAuditSubjectAclSql = (
  db: Db,
  subject: AuditSubjectColumns,
  changeRequestMode: AclMode,
  plan: AclPlan = "scan",
): AuditSubjectAclSql => {
  const spaceId = getContextSpaceId();
  const manager = getContextIsSpaceManager();

  // Both rules read the change request row of this space first (the audit list
  // selects those rows before filtering them); a manager's `list` rule stops there.
  const byChangeRequest = (() => {
    const acl = buildChangeRequestAclSql(db, subject.changeRequestId, changeRequestMode, plan);
    const row = changeRequestInSpace(db, subject.changeRequestId, plan);
    if (!acl) return { visible: row, needsScopeCheck: bool(false) };
    return { visible: and(row, acl.visible) as SQL, needsScopeCheck: acl.needsScopeCheck };
  })();

  const operation = alias(busabaseOperations, "acl_subject_operation");
  const operationAcl = buildChangeRequestAclSql(db, operation.changeRequestId, "permission", plan);
  const operationRow = (extra?: SQL) =>
    existsFor(
      plan,
      db
        .select({ one })
        .from(operation)
        .where(and(eq(operation.id, subject.operationId), eq(operation.spaceId, spaceId), extra)),
    );

  const commit = alias(busabaseCommits, "acl_subject_commit");
  const commitOperation = alias(busabaseOperations, "acl_subject_commit_operation");
  const commitAcl = buildChangeRequestAclSql(
    db,
    commitOperation.changeRequestId,
    "permission",
    plan,
  );
  // The JS join from the commit to its operation is not space-scoped either.
  const commitRow = (extra?: SQL) =>
    existsFor(
      plan,
      db
        .select({ one })
        .from(commit)
        .innerJoin(commitOperation, eq(commitOperation.id, commit.operationId))
        .where(and(eq(commit.id, subject.commitId), eq(commit.spaceId, spaceId), extra)),
    );

  const recordFallback = and(
    present(subject.recordId),
    recordReachable(db, subject.recordId, plan),
  );
  const noSubject = sql`not (${present(subject.baseId)} or ${present(subject.recordId)} or ${present(
    subject.changeRequestId,
  )} or ${present(subject.operationId)} or ${present(subject.commitId)})`;

  // `buildChangeRequestAclSql` in `permission` mode is never null.
  const operationVisible = (operationAcl as ChangeRequestAclSql).visible;
  const operationNeedsCheck = (operationAcl as ChangeRequestAclSql).needsScopeCheck;
  const commitVisible = (commitAcl as ChangeRequestAclSql).visible;
  const commitNeedsCheck = (commitAcl as ChangeRequestAclSql).needsScopeCheck;

  return {
    visible: caseWhen(
      [
        [noSubject, bool(manager)],
        [present(subject.changeRequestId), byChangeRequest.visible],
        [
          present(subject.operationId),
          sql`(${operationRow(operationVisible)} or (not ${operationRow()} and ${recordFallback}))`,
        ],
        [
          present(subject.commitId),
          sql`(${commitRow(commitVisible)} or (not ${commitRow()} and ${recordFallback}))`,
        ],
        [present(subject.recordId), recordReachable(db, subject.recordId, plan)],
      ],
      baseReachable(db, subject.baseId, plan),
    ),
    needsScopeCheck: caseWhen(
      [
        [noSubject, bool(false)],
        [present(subject.changeRequestId), byChangeRequest.needsScopeCheck],
        [present(subject.operationId), operationRow(operationNeedsCheck)],
        [present(subject.commitId), commitRow(commitNeedsCheck)],
      ],
      bool(false),
    ),
  };
};

/**
 * The record branch for an outer query over `busabase_records` itself (the
 * activity feed's record source): the record's Base — any space, as in JS —
 * then that Base's node.
 */
export const buildRecordRowAclSql = (db: Db): SQL => {
  const base = alias(busabaseBases, "acl_row_record_base");
  return exists(
    db
      .select({ one })
      .from(base)
      .where(
        and(eq(base.id, busabaseRecords.baseId), nodeReachable(db, base.nodeId, "permission")),
      ),
  );
};
