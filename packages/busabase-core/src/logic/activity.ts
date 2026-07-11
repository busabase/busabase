import "server-only";

import {
  type activityItemSchema,
  listActivityPagedInputSchema,
  type listActivityResponseSchema,
} from "busabase-contract/contract/activity-schemas";
import type { AuditEventVO, ChangeRequestVO, RecordVO } from "busabase-contract/types";
import { and, type Column, desc, eq, inArray, lt, lte, or, type SQL } from "drizzle-orm";
import type { z } from "zod";

// oRPC handlers return values matching the contract output schema's INPUT type
// (looser than z.infer/z.output), which is what accepts our hand-written VO
// interfaces — the same contract the other paged endpoints rely on.
type ActivityItem = z.input<typeof activityItemSchema>;

import { getContextSpaceId, resolveUserRefs } from "../context";
import { getDb } from "../db";
import {
  busabaseAuditEvents,
  busabaseChangeRequests,
  busabaseOperations,
  busabaseRecords,
} from "../db/schema";
import { ensureReady } from "./seed";
import { toAuditEventVO } from "./vo";

/**
 * Server-side, keyset-paginated activity feed. It reproduces the exact event set
 * the old client-side `buildActivityEvents` merged — change-request "updated"
 * rows, one row per operation, record rows, and audit rows — newest first, but
 * WITHOUT pulling the whole change-request / audit / record tables into the
 * browser.
 *
 * Ordering is a total order over (timestamp DESC, kind DESC, id DESC). Rather
 * than a fragile cross-table SQL UNION, each of the four sources is queried with
 * its own keyset predicate (derived from the cursor's fixed kind) and its own
 * `ORDER BY ts DESC, id DESC LIMIT n+1`, then merged in JS with a STABLE sort by
 * (ts, kind) only — so the id tiebreak is only ever compared in SQL (matching the
 * existing keyset code's collation), never JS-vs-SQL.
 */

// Fixed total order for the cross-source tiebreak at equal timestamps. Any stable
// assignment works as long as SQL keyset selection and the JS merge agree on it.
const KIND_ORDER = {
  change_request: 3,
  operation: 2,
  record: 1,
  audit: 0,
} as const;
type ActivityKind = keyof typeof KIND_ORDER;

interface RawEvent {
  ts: Date;
  kind: ActivityKind;
  id: string;
  /** owning change request (self for `change_request`, parent for `operation`). */
  changeRequestId: string | null;
  /** referenced record (self for `record`, the audit target for `audit`). */
  recordId: string | null;
}

// `|` separates the ISO timestamp (colons) from the kind and id (neither contains `|`).
const encodeActivityCursor = (ts: Date, kind: ActivityKind, id: string): string =>
  Buffer.from(`${ts.toISOString()}|${kind}|${id}`, "utf8").toString("base64");

const decodeActivityCursor = (
  cursor: string,
): { ts: Date; kind: ActivityKind; id: string } | null => {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const firstSep = decoded.indexOf("|");
    const secondSep = decoded.indexOf("|", firstSep + 1);
    if (firstSep < 0 || secondSep < 0) return null;
    const iso = decoded.slice(0, firstSep);
    const kind = decoded.slice(firstSep + 1, secondSep);
    const id = decoded.slice(secondSep + 1);
    const ts = new Date(iso);
    if (Number.isNaN(ts.getTime()) || !id || !(kind in KIND_ORDER)) return null;
    return { ts, kind: kind as ActivityKind, id };
  } catch {
    return null;
  }
};

/**
 * Keyset predicate for one source (fixed `kind`) given the decoded cursor. Selects
 * rows strictly AFTER the cursor in (ts DESC, kind DESC, id DESC) order:
 *   - kind sorts after the cursor's kind → include every row at ts = cursor.ts (`ts <= cts`)
 *   - same kind as the cursor → strict (ts, id) keyset
 *   - kind sorts before the cursor's kind → only ts < cursor.ts
 */
const keysetFor = (
  kind: ActivityKind,
  tsCol: Column,
  idCol: Column,
  cursor: { ts: Date; kind: ActivityKind; id: string } | null,
): SQL | undefined => {
  if (!cursor) return undefined;
  const cmp = KIND_ORDER[kind] - KIND_ORDER[cursor.kind];
  if (cmp < 0) return lte(tsCol, cursor.ts);
  if (cmp === 0)
    return or(lt(tsCol, cursor.ts), and(eq(tsCol, cursor.ts), lt(idCol, cursor.id))) as SQL;
  return lt(tsCol, cursor.ts);
};

export const listActivityPaged = async (
  input?: z.input<typeof listActivityPagedInputSchema>,
): Promise<z.input<typeof listActivityResponseSchema>> => {
  await ensureReady();
  const db = await getDb();
  const parsed = listActivityPagedInputSchema.parse(input);
  const limit = parsed.limit;
  const spaceId = getContextSpaceId();
  const cursor = parsed.cursor ? decodeActivityCursor(parsed.cursor) : null;

  // Each source: its own keyset + `ORDER BY ts DESC, id DESC LIMIT limit+1`. The
  // global top (limit+1) events are within the top (limit+1) of each source, so
  // this window is sufficient to build the page and detect a next page.
  const [crRows, opRows, recordRows, auditRows] = await Promise.all([
    db
      .select({ ts: busabaseChangeRequests.updatedAt, id: busabaseChangeRequests.id })
      .from(busabaseChangeRequests)
      .where(
        and(
          eq(busabaseChangeRequests.spaceId, spaceId),
          keysetFor(
            "change_request",
            busabaseChangeRequests.updatedAt,
            busabaseChangeRequests.id,
            cursor,
          ),
        ),
      )
      .orderBy(desc(busabaseChangeRequests.updatedAt), desc(busabaseChangeRequests.id))
      .limit(limit + 1),
    db
      .select({
        ts: busabaseOperations.updatedAt,
        id: busabaseOperations.id,
        changeRequestId: busabaseOperations.changeRequestId,
      })
      .from(busabaseOperations)
      .where(
        and(
          eq(busabaseOperations.spaceId, spaceId),
          keysetFor("operation", busabaseOperations.updatedAt, busabaseOperations.id, cursor),
        ),
      )
      .orderBy(desc(busabaseOperations.updatedAt), desc(busabaseOperations.id))
      .limit(limit + 1),
    db
      .select({ ts: busabaseRecords.updatedAt, id: busabaseRecords.id })
      .from(busabaseRecords)
      .where(
        and(
          eq(busabaseRecords.spaceId, spaceId),
          // Match the feed's record source (records.listPaged is active-only), so
          // archived records don't flood the activity feed with new events.
          eq(busabaseRecords.status, "active"),
          keysetFor("record", busabaseRecords.updatedAt, busabaseRecords.id, cursor),
        ),
      )
      .orderBy(desc(busabaseRecords.updatedAt), desc(busabaseRecords.id))
      .limit(limit + 1),
    db
      .select({
        ts: busabaseAuditEvents.createdAt,
        id: busabaseAuditEvents.id,
        recordId: busabaseAuditEvents.recordId,
      })
      .from(busabaseAuditEvents)
      .where(
        and(
          eq(busabaseAuditEvents.spaceId, spaceId),
          keysetFor("audit", busabaseAuditEvents.createdAt, busabaseAuditEvents.id, cursor),
        ),
      )
      .orderBy(desc(busabaseAuditEvents.createdAt), desc(busabaseAuditEvents.id))
      .limit(limit + 1),
  ]);

  // Concatenate per-source (each already SQL-ordered) then STABLE-sort by
  // (ts DESC, kind DESC). Same (ts, kind) rows all come from one source and keep
  // their SQL order, so the id tiebreak is never compared here.
  const merged: RawEvent[] = [
    ...crRows.map((row) => ({
      ts: row.ts,
      kind: "change_request" as const,
      id: row.id,
      changeRequestId: row.id,
      recordId: null,
    })),
    ...opRows.map((row) => ({
      ts: row.ts,
      kind: "operation" as const,
      id: row.id,
      changeRequestId: row.changeRequestId,
      recordId: null,
    })),
    ...recordRows.map((row) => ({
      ts: row.ts,
      kind: "record" as const,
      id: row.id,
      changeRequestId: null,
      recordId: row.id,
    })),
    ...auditRows.map((row) => ({
      ts: row.ts,
      kind: "audit" as const,
      id: row.id,
      changeRequestId: null,
      recordId: row.recordId,
    })),
  ];
  merged.sort((a, b) => b.ts.getTime() - a.ts.getTime() || KIND_ORDER[b.kind] - KIND_ORDER[a.kind]);

  const hasMore = merged.length > limit;
  const page = merged.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeActivityCursor(last.ts, last.kind, last.id) : null;

  // Batch-hydrate only the page's referenced entities (reuses the E-bucket batch
  // hydrators — one query per relation, not per row).
  const changeRequestIds = [
    ...new Set(
      page
        .filter((event) => event.kind === "change_request" || event.kind === "operation")
        .map((event) => event.changeRequestId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const recordIds = [
    ...new Set(
      page
        .filter((event) => event.kind === "record" || event.kind === "audit")
        .map((event) => event.recordId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const auditIds = page.filter((event) => event.kind === "audit").map((event) => event.id);

  const [crPOs, recordPOs, auditPOs] = await Promise.all([
    changeRequestIds.length > 0
      ? db
          .select()
          .from(busabaseChangeRequests)
          .where(
            and(
              inArray(busabaseChangeRequests.id, changeRequestIds),
              eq(busabaseChangeRequests.spaceId, spaceId),
            ),
          )
      : Promise.resolve([]),
    recordIds.length > 0
      ? db
          .select()
          .from(busabaseRecords)
          .where(and(inArray(busabaseRecords.id, recordIds), eq(busabaseRecords.spaceId, spaceId)))
      : Promise.resolve([]),
    auditIds.length > 0
      ? db
          .select()
          .from(busabaseAuditEvents)
          .where(
            and(
              inArray(busabaseAuditEvents.id, auditIds),
              eq(busabaseAuditEvents.spaceId, spaceId),
            ),
          )
      : Promise.resolve([]),
  ]);

  // Lazy import breaks the module-load cycle (cr-lifecycle pulls in the whole
  // merge/handler graph); by the time this runs it is fully initialized.
  const { hydrateChangeRequests, hydrateRecords, LIST_MAX_OPERATIONS_PER_CHANGE_REQUEST } =
    await import("./cr-lifecycle");
  const [crVOs, recordVOs] = await Promise.all([
    hydrateChangeRequests(crPOs, {
      maxOperationsPerChangeRequest: LIST_MAX_OPERATIONS_PER_CHANGE_REQUEST,
    }),
    hydrateRecords(recordPOs),
  ]);
  const crById = new Map(crVOs.map((cr) => [cr.id, cr]));
  const operationIdsByCrId = new Map(
    crVOs.map((cr) => [cr.id, new Set(cr.operations.map((operation) => operation.id))]),
  );
  const recordById = new Map(recordVOs.map((record) => [record.id, record]));
  const auditUsers = await resolveUserRefs(auditPOs.map((event) => event.actorId));
  const auditById = new Map(auditPOs.map((event) => [event.id, toAuditEventVO(event, auditUsers)]));

  const items: ActivityItem[] = [];
  for (const event of page) {
    if (event.kind === "change_request") {
      const changeRequest = crById.get(event.id);
      if (changeRequest)
        items.push({ kind: "change_request", timestamp: event.ts.toISOString(), changeRequest });
    } else if (event.kind === "operation") {
      const changeRequest = event.changeRequestId ? crById.get(event.changeRequestId) : undefined;
      if (changeRequest && operationIdsByCrId.get(changeRequest.id)?.has(event.id))
        items.push({
          kind: "operation",
          timestamp: event.ts.toISOString(),
          operationId: event.id,
          changeRequest,
        });
    } else if (event.kind === "record") {
      const record = recordById.get(event.id);
      if (record) items.push({ kind: "record", timestamp: event.ts.toISOString(), record });
    } else {
      const auditEvent = auditById.get(event.id);
      if (auditEvent)
        items.push({
          kind: "audit",
          timestamp: event.ts.toISOString(),
          auditEvent,
          record: event.recordId ? (recordById.get(event.recordId) ?? null) : null,
        });
    }
  }

  return { items, nextCursor };
};

/**
 * Build the full (unpaginated) activity descriptor list from already-loaded VOs,
 * newest first. Used by the demo router (small, static dataset — no keyset needed)
 * and as the reference for the descriptor shapes. Mirrors the event set of
 * `listActivityPaged`: one item per CR, per operation, per record, per audit event.
 */
export const buildActivityItemsFromVOs = (
  changeRequests: ChangeRequestVO[],
  records: RecordVO[],
  auditEvents: AuditEventVO[],
): ActivityItem[] => {
  const recordById = new Map(records.map((record) => [record.id, record]));
  const items: ActivityItem[] = [];
  for (const changeRequest of changeRequests) {
    items.push({ kind: "change_request", timestamp: changeRequest.updatedAt, changeRequest });
    for (const operation of changeRequest.operations) {
      items.push({
        kind: "operation",
        timestamp: operation.updatedAt,
        operationId: operation.id,
        changeRequest,
      });
    }
  }
  for (const record of records) {
    items.push({ kind: "record", timestamp: record.updatedAt, record });
  }
  for (const auditEvent of auditEvents) {
    items.push({
      kind: "audit",
      timestamp: auditEvent.createdAt,
      auditEvent,
      record: auditEvent.recordId ? (recordById.get(auditEvent.recordId) ?? null) : null,
    });
  }
  return items.sort(
    (first, second) => new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime(),
  );
};
