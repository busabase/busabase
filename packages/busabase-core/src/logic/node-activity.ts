import "server-only";

import type { activityItemSchema } from "busabase-contract/contract/activity-schemas";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { z } from "zod";
import { getContextSpaceId, resolveUserRefs } from "../context";
import { getDb } from "../db";
import {
  busabaseAuditEvents,
  busabaseBases,
  busabaseChangeRequests,
  busabaseNodes,
  busabaseOperations,
} from "../db/schema";
import { assertAuditSubjectPermission, isAuditVisibilityMiss } from "./audit";
import { listInputSchema } from "./kernel";
import { assertNodePermission } from "./node-acl";
import { ensureReady } from "./seed";
import { toAuditEventVO } from "./vo";

// oRPC handlers return values matching the contract output schema's INPUT type
// (looser than z.infer/z.output) — same convention `listActivityPaged` uses.
type ActivityItem = z.input<typeof activityItemSchema>;

export { listInputSchema };

/**
 * Simple, node-scoped raw activity stream — a flat, newest-first list of the
 * events this ONE node participated in (change requests, operations, and,
 * only when the node is a Base, audit events on that Base). Unlike
 * `listActivityPaged` this is offset/limit only (no keyset pagination) and
 * does NOT aggregate into version numbers (v1/v2/v3) — it's the raw stream,
 * reusing the exact `ActivityItem` shape the global feed produces so the
 * client's existing `ActivityRow` / `buildActivityEventFromItem` render it
 * unmodified.
 *
 * Deliberate simplifications (this is a lightweight per-node panel, not a
 * replacement for the global feed):
 * - This is the BASE's own activity, not every record inside it — records
 *   don't carry a `nodeId` (only `baseId`), so pulling every record change
 *   for a Base into its node-level panel would blow past "simple" (and
 *   swamp the Base's own creation/design history in per-row noise). A single
 *   record's own history is `listRecordActivity` below, not this function.
 *   Audit events that DO reference a record are still shown here, just with
 *   `record` left `null` (the schema allows it) instead of hydrating it.
 * - Commits are not surfaced as their own row — there is no `commit` kind in
 *   `activityItemSchema` (the global feed doesn't have one either); commit
 *   history is implicitly covered by the operation/change-request rows.
 */
export const listNodeActivity = async (
  nodeId: string,
  input?: z.input<typeof listInputSchema>,
): Promise<ActivityItem[]> => {
  await ensureReady();
  // Gate on the node itself BEFORE querying anything else, so an
  // unauthorized caller gets a clean permission error rather than an empty
  // list that leaks the node's existence.
  await assertNodePermission(nodeId, "read");

  const db = await getDb();
  const spaceId = getContextSpaceId();
  const parsed = listInputSchema.parse(input);
  const limit = parsed.limit;

  const [node] = await db
    .select({ type: busabaseNodes.type })
    .from(busabaseNodes)
    .where(and(eq(busabaseNodes.id, nodeId), eq(busabaseNodes.spaceId, spaceId)))
    .limit(1);
  const [base] = await db
    .select({ id: busabaseBases.id })
    .from(busabaseBases)
    .where(and(eq(busabaseBases.nodeId, nodeId), eq(busabaseBases.spaceId, spaceId)))
    .limit(1);
  const isBase = node?.type === "base";

  const [crRows, opRows, auditRows] = await Promise.all([
    db
      .select()
      .from(busabaseChangeRequests)
      .where(
        and(eq(busabaseChangeRequests.nodeId, nodeId), eq(busabaseChangeRequests.spaceId, spaceId)),
      )
      .orderBy(desc(busabaseChangeRequests.updatedAt), desc(busabaseChangeRequests.id))
      .limit(limit),
    db
      .select()
      .from(busabaseOperations)
      .where(and(eq(busabaseOperations.nodeId, nodeId), eq(busabaseOperations.spaceId, spaceId)))
      .orderBy(desc(busabaseOperations.updatedAt), desc(busabaseOperations.id))
      .limit(limit),
    isBase && base
      ? db
          .select()
          .from(busabaseAuditEvents)
          .where(
            and(eq(busabaseAuditEvents.baseId, base.id), eq(busabaseAuditEvents.spaceId, spaceId)),
          )
          .orderBy(desc(busabaseAuditEvents.createdAt), desc(busabaseAuditEvents.id))
          .limit(limit)
      : Promise.resolve([] as (typeof busabaseAuditEvents.$inferSelect)[]),
  ]);

  // Load every change request either row set needs (a CR row's own subject,
  // or an operation row's owning CR), then permission-filter + hydrate them
  // exactly like `listAuditEvents` / `listActivityPaged` do.
  const changeRequestIds = [
    ...new Set([...crRows.map((row) => row.id), ...opRows.map((row) => row.changeRequestId)]),
  ];
  const crPOs = changeRequestIds.length
    ? await db
        .select()
        .from(busabaseChangeRequests)
        .where(
          and(
            inArray(busabaseChangeRequests.id, changeRequestIds),
            eq(busabaseChangeRequests.spaceId, spaceId),
          ),
        )
    : [];
  const crVisibility = await Promise.all(
    crPOs.map(async (cr) => {
      try {
        await assertAuditSubjectPermission({ changeRequestId: cr.id }, "read");
        return true;
      } catch (error) {
        if (isAuditVisibilityMiss(error)) return false;
        throw error;
      }
    }),
  );
  const visibleCrPOs = crPOs.filter((_, index) => crVisibility[index]);

  const auditVisibility = await Promise.all(
    auditRows.map(async (event) => {
      if (event.changeRequestId) {
        return visibleCrPOs.some((cr) => cr.id === event.changeRequestId);
      }
      try {
        await assertAuditSubjectPermission(event, "read");
        return true;
      } catch (error) {
        if (isAuditVisibilityMiss(error)) return false;
        throw error;
      }
    }),
  );
  const visibleAuditRows = auditRows.filter((_, index) => auditVisibility[index]);

  // Lazy import breaks the module-load cycle (cr-lifecycle pulls in the whole
  // merge/handler graph), same as `activity.ts`.
  const { hydrateChangeRequests, LIST_MAX_OPERATIONS_PER_CHANGE_REQUEST } = await import(
    "./cr-lifecycle"
  );
  const crVOs = await hydrateChangeRequests(visibleCrPOs, {
    maxOperationsPerChangeRequest: LIST_MAX_OPERATIONS_PER_CHANGE_REQUEST,
  });
  const crById = new Map(crVOs.map((cr) => [cr.id, cr]));
  const operationIdsByCrId = new Map(
    crVOs.map((cr) => [cr.id, new Set(cr.operations.map((operation) => operation.id))]),
  );

  const auditUsers = await resolveUserRefs(visibleAuditRows.map((event) => event.actorId));

  const items: (ActivityItem & { timestamp: string })[] = [];

  for (const row of crRows) {
    const changeRequest = crById.get(row.id);
    if (changeRequest) {
      items.push({ kind: "change_request", timestamp: row.updatedAt.toISOString(), changeRequest });
    }
  }

  for (const row of opRows) {
    const changeRequest = crById.get(row.changeRequestId);
    if (changeRequest && operationIdsByCrId.get(changeRequest.id)?.has(row.id)) {
      items.push({
        kind: "operation",
        timestamp: row.updatedAt.toISOString(),
        operationId: row.id,
        changeRequest,
      });
    }
  }

  for (const event of visibleAuditRows) {
    items.push({
      kind: "audit",
      timestamp: event.createdAt.toISOString(),
      auditEvent: toAuditEventVO(event, auditUsers),
      record: null,
    });
  }

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return items.slice(0, limit);
};

/**
 * Same shape and simplifications as `listNodeActivity` above, but scoped to a
 * single RECORD instead of a node — `busabase_audit_events` carries its own
 * `recordId` column (indexed), and `busabase_operations` carries
 * `targetRecordId`/`sourceRecordId`/`mergedRecordId`, so this is a direct
 * column filter, not a derived/joined scope.
 */
export const listRecordActivity = async (
  recordId: string,
  input?: z.input<typeof listInputSchema>,
): Promise<ActivityItem[]> => {
  await ensureReady();
  // Resolves record -> base -> node ACL, same permission chain the record's
  // own reads/writes already go through.
  await assertAuditSubjectPermission({ recordId }, "read");

  const db = await getDb();
  const spaceId = getContextSpaceId();
  const parsed = listInputSchema.parse(input);
  const limit = parsed.limit;

  const [opRows, auditRows] = await Promise.all([
    db
      .select()
      .from(busabaseOperations)
      .where(
        and(
          eq(busabaseOperations.spaceId, spaceId),
          or(
            eq(busabaseOperations.targetRecordId, recordId),
            eq(busabaseOperations.sourceRecordId, recordId),
            eq(busabaseOperations.mergedRecordId, recordId),
          ),
        ),
      )
      .orderBy(desc(busabaseOperations.updatedAt), desc(busabaseOperations.id))
      .limit(limit),
    db
      .select()
      .from(busabaseAuditEvents)
      .where(
        and(eq(busabaseAuditEvents.recordId, recordId), eq(busabaseAuditEvents.spaceId, spaceId)),
      )
      .orderBy(desc(busabaseAuditEvents.createdAt), desc(busabaseAuditEvents.id))
      .limit(limit),
  ]);

  // Same hydrate-then-permission-filter shape as `listNodeActivity` — an
  // operation row is only shown once its owning change request is both
  // resolved AND visible.
  const changeRequestIds = [...new Set(opRows.map((row) => row.changeRequestId))];
  const crPOs = changeRequestIds.length
    ? await db
        .select()
        .from(busabaseChangeRequests)
        .where(
          and(
            inArray(busabaseChangeRequests.id, changeRequestIds),
            eq(busabaseChangeRequests.spaceId, spaceId),
          ),
        )
    : [];
  const crVisibility = await Promise.all(
    crPOs.map(async (cr) => {
      try {
        await assertAuditSubjectPermission({ changeRequestId: cr.id }, "read");
        return true;
      } catch (error) {
        if (isAuditVisibilityMiss(error)) return false;
        throw error;
      }
    }),
  );
  const visibleCrPOs = crPOs.filter((_, index) => crVisibility[index]);

  const auditVisibility = await Promise.all(
    auditRows.map(async (event) => {
      if (event.changeRequestId) {
        return visibleCrPOs.some((cr) => cr.id === event.changeRequestId);
      }
      try {
        await assertAuditSubjectPermission(event, "read");
        return true;
      } catch (error) {
        if (isAuditVisibilityMiss(error)) return false;
        throw error;
      }
    }),
  );
  const visibleAuditRows = auditRows.filter((_, index) => auditVisibility[index]);

  const { hydrateChangeRequests, LIST_MAX_OPERATIONS_PER_CHANGE_REQUEST } = await import(
    "./cr-lifecycle"
  );
  const crVOs = await hydrateChangeRequests(visibleCrPOs, {
    maxOperationsPerChangeRequest: LIST_MAX_OPERATIONS_PER_CHANGE_REQUEST,
  });
  const crById = new Map(crVOs.map((cr) => [cr.id, cr]));
  const operationIdsByCrId = new Map(
    crVOs.map((cr) => [cr.id, new Set(cr.operations.map((operation) => operation.id))]),
  );

  const auditUsers = await resolveUserRefs(visibleAuditRows.map((event) => event.actorId));

  const items: (ActivityItem & { timestamp: string })[] = [];

  for (const row of opRows) {
    const changeRequest = crById.get(row.changeRequestId);
    if (changeRequest && operationIdsByCrId.get(changeRequest.id)?.has(row.id)) {
      items.push({
        kind: "operation",
        timestamp: row.updatedAt.toISOString(),
        operationId: row.id,
        changeRequest,
      });
    }
  }

  for (const event of visibleAuditRows) {
    items.push({
      kind: "audit",
      timestamp: event.createdAt.toISOString(),
      auditEvent: toAuditEventVO(event, auditUsers),
      record: null,
    });
  }

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return items.slice(0, limit);
};
