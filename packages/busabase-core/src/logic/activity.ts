import "server-only";

import {
  type activityItemSchema,
  listActivityPagedInputSchema,
  type listActivityResponseSchema,
  listRecordActivityPagedInputSchema,
} from "busabase-contract/contract/activity-schemas";
import type { AuditEventVO, ChangeRequestVO, RecordVO } from "busabase-contract/types";
import { and, type Column, desc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
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
import { applyPlaybookAttributionVisibility } from "../domains/playbooks/logic/playbook-attribution";
import {
  buildAuditSubjectAclSql,
  buildChangeRequestAclSql,
  buildRecordRowAclSql,
} from "./acl-list-sql";
import { type AuditSubjectRef, assertAuditSubjectPermission, isAuditVisibilityMiss } from "./audit";
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
 * than issuing a single SQL UNION (the four sources use three different
 * timestamp columns), each source is queried with LIMIT n+1 under
 * its own keyset predicate (derived from the cursor's fixed kind) and its own
 * `ORDER BY ts DESC, id DESC LIMIT n+1`, then merged in JS by the same
 * (ts, kind, id) order. Timestamps travel as microsecond UTC keys (not JS
 * Date) so page cursors do not truncate sub-ms values and skip rows. Ids are
 * opaque ASCII (`crq…` / `opr…` / …); JS `<` matches PostgreSQL's default
 * collation on that alphabet.
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

interface RawEvent extends AuditSubjectRef {
  ts: Date;
  /** UTC microsecond key (`YYYY-MM-DDTHH:MM:SS.μμμμμμZ`) — JS Date is only ms. */
  tsKey: string;
  kind: ActivityKind;
  id: string;
  /** owning change request (self for `change_request`, parent for `operation`). */
  changeRequestId: string | null;
  /** referenced record (self for `record`, the audit target for `audit`). */
  recordId: string | null;
  /**
   * The SQL access predicate could not decide this row alone (a change request
   * with an operation that names neither node nor Base); re-check it in JS.
   */
  needsScopeCheck?: boolean;
}

// Microsecond UTC text — JS `Date` only stores milliseconds, and ~all rows in a
// busy space have sub-ms timestamps. Encoding the cursor with `toISOString()`
// truncated those away; the next page's keyset then skipped every row whose
// fractional milliseconds sat between the truncated cursor and the real value.
const tsKeySql = (tsCol: Column): SQL<string> =>
  sql<string>`to_char(${tsCol} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// `|` separates the tsKey (colons) from the kind and id (neither contains `|`).
const encodeActivityCursor = (tsKey: string, kind: ActivityKind, id: string): string =>
  Buffer.from(`${tsKey}|${kind}|${id}`, "utf8").toString("base64");

const decodeActivityCursor = (
  cursor: string,
): { tsKey: string; kind: ActivityKind; id: string } | null => {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const firstSep = decoded.indexOf("|");
    const secondSep = decoded.indexOf("|", firstSep + 1);
    if (firstSep < 0 || secondSep < 0) return null;
    const tsKey = decoded.slice(0, firstSep);
    const kind = decoded.slice(firstSep + 1, secondSep);
    const id = decoded.slice(secondSep + 1);
    if (!tsKey || !id || !(kind in KIND_ORDER)) return null;
    // Accept legacy ms-ISO cursors and new microsecond keys alike — both parse
    // as timestamptz. Legacy cursors may still skip at their last boundary.
    if (Number.isNaN(Date.parse(tsKey))) return null;
    return { tsKey, kind: kind as ActivityKind, id };
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
  cursor: { tsKey: string; kind: ActivityKind; id: string } | null,
): SQL | undefined => {
  if (!cursor) return undefined;
  const cts = sql`${cursor.tsKey}::timestamptz`;
  const cmp = KIND_ORDER[kind] - KIND_ORDER[cursor.kind];
  if (cmp < 0) return sql`${tsCol} <= ${cts}`;
  if (cmp === 0) return sql`(${tsCol} < ${cts} OR (${tsCol} = ${cts} AND ${idCol} < ${cursor.id}))`;
  return sql`${tsCol} < ${cts}`;
};

export const listActivityPaged = async (
  input?: z.input<typeof listActivityPagedInputSchema>,
  recordId?: string,
): Promise<z.input<typeof listActivityResponseSchema>> => {
  await ensureReady();
  if (recordId) await assertAuditSubjectPermission({ recordId }, "read");
  const db = await getDb();
  const parsed = listActivityPagedInputSchema.parse(input);
  const limit = parsed.limit;
  const spaceId = getContextSpaceId();
  const initialCursor = parsed.cursor ? decodeActivityCursor(parsed.cursor) : null;
  const batchSize = limit + 1;

  // Access is decided in each source's WHERE — the same rule
  // `assertAuditSubjectPermission(event, "read")` applies per event (see
  // acl-list-sql.ts) — so a window only carries rows the caller can see. A row
  // the predicate flags is re-checked in JS below.
  const changeRequestAcl = buildChangeRequestAclSql(db, busabaseChangeRequests.id, "permission");
  const operationAcl = buildChangeRequestAclSql(
    db,
    busabaseOperations.changeRequestId,
    "permission",
  );
  if (!changeRequestAcl || !operationAcl) throw new Error("permission ACL is never null");
  const auditAcl = buildAuditSubjectAclSql(
    db,
    {
      baseId: busabaseAuditEvents.baseId,
      recordId: busabaseAuditEvents.recordId,
      changeRequestId: busabaseAuditEvents.changeRequestId,
      operationId: busabaseAuditEvents.operationId,
      commitId: busabaseAuditEvents.commitId,
    },
    "permission",
    // Walked through the (space, created_at, id) index until a page is full:
    // probe row by row. The other sources sort on a column no index covers,
    // so they examine every row anyway and let PostgreSQL hash.
    "probe",
  );

  const fetchWindow = async (cursor: typeof initialCursor) => {
    const [crRows, opRows, recordRows, auditRows] = await Promise.all([
      recordId
        ? Promise.resolve([])
        : db
            .select({
              ts: busabaseChangeRequests.updatedAt,
              tsKey: tsKeySql(busabaseChangeRequests.updatedAt),
              id: busabaseChangeRequests.id,
              needsScopeCheck: sql<boolean>`${changeRequestAcl.needsScopeCheck}`,
            })
            .from(busabaseChangeRequests)
            .where(
              and(
                eq(busabaseChangeRequests.spaceId, spaceId),
                changeRequestAcl.visible,
                keysetFor(
                  "change_request",
                  busabaseChangeRequests.updatedAt,
                  busabaseChangeRequests.id,
                  cursor,
                ),
              ),
            )
            .orderBy(desc(busabaseChangeRequests.updatedAt), desc(busabaseChangeRequests.id))
            .limit(batchSize),
      db
        .select({
          ts: busabaseOperations.updatedAt,
          tsKey: tsKeySql(busabaseOperations.updatedAt),
          id: busabaseOperations.id,
          changeRequestId: busabaseOperations.changeRequestId,
          needsScopeCheck: sql<boolean>`${operationAcl.needsScopeCheck}`,
        })
        .from(busabaseOperations)
        .where(
          and(
            eq(busabaseOperations.spaceId, spaceId),
            operationAcl.visible,
            recordId
              ? or(
                  eq(busabaseOperations.targetRecordId, recordId),
                  eq(busabaseOperations.sourceRecordId, recordId),
                  eq(busabaseOperations.mergedRecordId, recordId),
                )
              : undefined,
            keysetFor("operation", busabaseOperations.updatedAt, busabaseOperations.id, cursor),
          ),
        )
        .orderBy(desc(busabaseOperations.updatedAt), desc(busabaseOperations.id))
        .limit(batchSize),
      recordId
        ? Promise.resolve([])
        : db
            .select({
              ts: busabaseRecords.updatedAt,
              tsKey: tsKeySql(busabaseRecords.updatedAt),
              id: busabaseRecords.id,
            })
            .from(busabaseRecords)
            .where(
              and(
                eq(busabaseRecords.spaceId, spaceId),
                // Match the feed's record source (records.list is active-only), so
                // archived records don't flood the activity feed with new events.
                eq(busabaseRecords.status, "active"),
                buildRecordRowAclSql(db),
                keysetFor("record", busabaseRecords.updatedAt, busabaseRecords.id, cursor),
              ),
            )
            .orderBy(desc(busabaseRecords.updatedAt), desc(busabaseRecords.id))
            .limit(batchSize),
      db
        .select({
          ts: busabaseAuditEvents.createdAt,
          tsKey: tsKeySql(busabaseAuditEvents.createdAt),
          id: busabaseAuditEvents.id,
          baseId: busabaseAuditEvents.baseId,
          recordId: busabaseAuditEvents.recordId,
          changeRequestId: busabaseAuditEvents.changeRequestId,
          operationId: busabaseAuditEvents.operationId,
          commitId: busabaseAuditEvents.commitId,
          needsScopeCheck: sql<boolean>`${auditAcl.needsScopeCheck}`,
        })
        .from(busabaseAuditEvents)
        .where(
          and(
            eq(busabaseAuditEvents.spaceId, spaceId),
            auditAcl.visible,
            recordId ? eq(busabaseAuditEvents.recordId, recordId) : undefined,
            keysetFor("audit", busabaseAuditEvents.createdAt, busabaseAuditEvents.id, cursor),
          ),
        )
        .orderBy(desc(busabaseAuditEvents.createdAt), desc(busabaseAuditEvents.id))
        .limit(batchSize),
    ]);
    const events: RawEvent[] = [
      ...crRows.map((row) => ({
        ts: row.ts,
        tsKey: row.tsKey,
        kind: "change_request" as const,
        id: row.id,
        changeRequestId: row.id,
        recordId: null,
        operationId: null,
        needsScopeCheck: row.needsScopeCheck,
      })),
      ...opRows.map((row) => ({
        ts: row.ts,
        tsKey: row.tsKey,
        kind: "operation" as const,
        id: row.id,
        changeRequestId: row.changeRequestId,
        operationId: row.id,
        recordId: null,
        needsScopeCheck: row.needsScopeCheck,
      })),
      ...recordRows.map((row) => ({
        ts: row.ts,
        tsKey: row.tsKey,
        kind: "record" as const,
        id: row.id,
        changeRequestId: null,
        recordId: row.id,
        operationId: null,
      })),
      ...auditRows.map((row) => ({
        ts: row.ts,
        tsKey: row.tsKey,
        kind: "audit" as const,
        id: row.id,
        recordId: row.recordId,
        baseId: row.baseId,
        changeRequestId: row.changeRequestId,
        operationId: row.operationId,
        commitId: row.commitId,
        needsScopeCheck: row.needsScopeCheck,
      })),
    ];
    const continuation: RawEvent[] = [];
    const lastCr = crRows.length === batchSize ? crRows.at(-1) : undefined;
    if (lastCr) {
      continuation.push({
        ts: lastCr.ts,
        tsKey: lastCr.tsKey,
        kind: "change_request",
        id: lastCr.id,
        changeRequestId: lastCr.id,
        recordId: null,
      });
    }
    const lastOperation = opRows.length === batchSize ? opRows.at(-1) : undefined;
    if (lastOperation) {
      continuation.push({
        ts: lastOperation.ts,
        tsKey: lastOperation.tsKey,
        kind: "operation",
        id: lastOperation.id,
        changeRequestId: lastOperation.changeRequestId,
        operationId: lastOperation.id,
        recordId: null,
      });
    }
    const lastRecord = recordRows.length === batchSize ? recordRows.at(-1) : undefined;
    if (lastRecord) {
      continuation.push({
        ts: lastRecord.ts,
        tsKey: lastRecord.tsKey,
        kind: "record",
        id: lastRecord.id,
        changeRequestId: null,
        recordId: lastRecord.id,
      });
    }
    const lastAudit = auditRows.length === batchSize ? auditRows.at(-1) : undefined;
    if (lastAudit) {
      continuation.push({
        ts: lastAudit.ts,
        tsKey: lastAudit.tsKey,
        kind: "audit",
        id: lastAudit.id,
        baseId: lastAudit.baseId,
        recordId: lastAudit.recordId,
        changeRequestId: lastAudit.changeRequestId,
        operationId: lastAudit.operationId,
        commitId: lastAudit.commitId,
      });
    }
    return { events, continuation };
  };

  const compareEvents = (a: RawEvent, b: RawEvent) =>
    // DESC by microsecond key (string order matches chronological UTC order),
    // then kind, then id — same total order as each source's SQL keyset.
    (a.tsKey < b.tsKey ? 1 : a.tsKey > b.tsKey ? -1 : 0) ||
    KIND_ORDER[b.kind] - KIND_ORDER[a.kind] ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  const visibleByKey = new Map<string, RawEvent>();
  let cursor = initialCursor;
  let continuationBoundary: RawEvent | null = null;
  for (;;) {
    const window = await fetchWindow(cursor);
    const unseen = window.events.filter((event) => !visibleByKey.has(`${event.kind}:${event.id}`));
    const visibility = await Promise.all(
      unseen.map(async (event) => {
        // The SQL predicate already decided every unflagged row.
        if (!event.needsScopeCheck) return true;
        try {
          await assertAuditSubjectPermission(event, "read");
          return true;
        } catch (error) {
          if (isAuditVisibilityMiss(error)) return false;
          throw error;
        }
      }),
    );
    unseen.forEach((event, index) => {
      if (visibility[index]) visibleByKey.set(`${event.kind}:${event.id}`, event);
    });
    continuationBoundary = window.continuation.sort(compareEvents)[0] ?? null;
    const visibleSoFar = [...visibleByKey.values()].sort(compareEvents);
    const threshold = visibleSoFar[limit];
    // With id in the comparator, equal (ts, kind, id) is a true duplicate; any
    // strict order difference against the continuation boundary is decisive.
    if (
      !continuationBoundary ||
      (threshold && compareEvents(threshold, continuationBoundary) < 0)
    ) {
      break;
    }
    const next = {
      tsKey: continuationBoundary.tsKey,
      kind: continuationBoundary.kind,
      id: continuationBoundary.id,
    };
    if (
      cursor &&
      cursor.tsKey === next.tsKey &&
      cursor.kind === next.kind &&
      cursor.id === next.id
    ) {
      break;
    }
    cursor = next;
  }

  const visible = [...visibleByKey.values()].sort(compareEvents);
  const hasMore = visible.length > limit;
  const page = visible.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeActivityCursor(last.tsKey, last.kind, last.id) : null;

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
      ...(recordId
        ? {
            maxOperationsPerChangeRequest: limit,
            includeReviews: false,
            operationIds: page
              .filter((event) => event.kind === "operation")
              .map((event) => event.id),
          }
        : { maxOperationsPerChangeRequest: LIST_MAX_OPERATIONS_PER_CHANGE_REQUEST }),
    }),
    hydrateRecords(recordPOs, recordId ? { summary: true } : undefined),
  ]);
  const crById = new Map(crVOs.map((cr) => [cr.id, cr]));
  const operationIdsByCrId = new Map(
    crVOs.map((cr) => [cr.id, new Set(cr.operations.map((operation) => operation.id))]),
  );
  const recordById = new Map(recordVOs.map((record) => [record.id, record]));
  const auditUsers = await resolveUserRefs(auditPOs.map((event) => event.actorId));
  const auditVOs = await applyPlaybookAttributionVisibility(
    auditPOs.map((event) => toAuditEventVO(event, auditUsers)),
  );
  const auditById = new Map(auditVOs.map((event) => [event.id, event]));

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

export const listRecordActivityPaged = async (
  input: z.input<typeof listRecordActivityPagedInputSchema>,
): Promise<z.input<typeof listActivityResponseSchema>> => {
  const { recordId, ...page } = listRecordActivityPagedInputSchema.parse(input);
  return listActivityPaged(page, recordId);
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
