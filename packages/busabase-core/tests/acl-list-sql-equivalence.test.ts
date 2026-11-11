import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  runWithAnonymousContext,
  runWithBusabaseContext,
  runWithEmbedContext,
} from "../src/context";
import { getDb } from "../src/db";
import {
  busabaseAuditEvents,
  busabaseBases,
  busabaseChangeRequests,
  busabaseCommits,
  busabaseNodes,
  busabaseOperations,
  busabaseRecords,
} from "../src/db/schema";
import { listActivityPaged } from "../src/logic/activity";
import {
  assertAuditSubjectPermission,
  isAuditVisibilityMiss,
  listAuditEvents,
} from "../src/logic/audit";
import { clearChangeRequestScopeCache } from "../src/logic/change-request-scope-cache";
import {
  countChangeRequests,
  countReviewChangeRequests,
  filterVisibleChangeRequestRows,
  getInboxSnapshot,
  listChangeRequestsPage,
  listChangeRequestsPaged,
} from "../src/logic/cr-lifecycle";
import { rootNodeIdForSpace } from "../src/logic/kernel";
import { setNodeShare } from "../src/logic/node-share";
import { busabaseRouter } from "../src/router";

/**
 * The inbox, its badges, the change request pages, the activity feed and the
 * audit list decide access in SQL (`logic/acl-list-sql.ts`). They used to read
 * rows and run a per-row JS check: `filterVisibleChangeRequestRows` for change
 * requests, `assertAuditSubjectPermission(_, "read")` for activity and audit.
 * Those checks still exist and are the reference here: for every kind of
 * caller, each list must return exactly what "read every row, run the per-row
 * check, then page" returns — same ids, same order, same counts, same cursors.
 *
 * The space is seeded to hit every branch of both checks: open, private,
 * workspace and publicly shared folders; user and space grants; a Base at the
 * workspace root; change requests in every status, touching open and hidden
 * Bases, several at once, the workspace root, a node or a Base of another
 * space, nothing at all, and pending node creates whose scope only the JS
 * resolver can place (parent id, parent ref chains, an undeclared ref); audit
 * rows with every subject shape; and timestamps that tie.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const SPACE = "acl-equivalence";
const OTHER_SPACE = "acl-equivalence-other";
const OWNER = "acl-owner";
const MEMBER = "acl-member";
const GRANTED = "acl-granted";
const GUEST = "acl-guest";
const STATUSES = [
  "in_review",
  "changes_requested",
  "approved",
  "merged",
  "rejected",
  "abandoned",
  "conflict",
] as const;

// Each test walks every list for ten kinds of caller against a per-row reference.
const TEST_TIMEOUT_MS = 300_000;

type Run = <T>(fn: () => Promise<T>) => Promise<T>;
interface Actor {
  name: string;
  run: Run;
}

describe("access filtering in SQL returns what the per-row checks return", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let actors: Actor[] = [];
  let openRecordId = "";
  let privateRecordId = "";
  let fixtureSequence = 0;

  const asOwner: Run = (fn) =>
    runWithBusabaseContext(
      { spaceId: SPACE, actorId: OWNER, isSpaceManager: true, permissionLevel: "manage" },
      fn,
    );
  const asOtherSpaceOwner: Run = (fn) =>
    runWithBusabaseContext(
      { spaceId: OTHER_SPACE, actorId: OWNER, isSpaceManager: true, permissionLevel: "manage" },
      fn,
    );
  const member =
    (actorId: string, extra: Record<string, unknown> = {}): Run =>
    (fn) =>
      runWithBusabaseContext(
        {
          spaceId: SPACE,
          actorId,
          isSpaceManager: false,
          permissionLevel: "write",
          ...extra,
        },
        fn,
      );

  const nodeIdBySlug = async (spaceId: string, slug: string) => {
    const db = await getDb();
    const [row] = await db
      .select({ id: busabaseNodes.id })
      .from(busabaseNodes)
      .where(and(eq(busabaseNodes.spaceId, spaceId), eq(busabaseNodes.slug, slug)));
    if (!row) throw new Error(`missing node ${slug}`);
    return row.id;
  };

  /** A change request row plus raw operations, for scopes the API cannot produce. */
  const insertChangeRequest = async (input: {
    rowBaseId: string;
    status?: (typeof STATUSES)[number];
    operations: {
      nodeId?: string | null;
      baseId?: string | null;
      operation?: "record_create" | "node_create";
      payload?: Record<string, unknown>;
    }[];
  }) => {
    const db = await getDb();
    const sequence = fixtureSequence++;
    const changeRequestId = `crq_acl_eq_${sequence}`;
    await db.insert(busabaseChangeRequests).values({
      id: changeRequestId,
      spaceId: SPACE,
      baseId: input.rowBaseId,
      status: input.status ?? "in_review",
      submittedBy: OWNER,
    });
    for (const [position, operation] of input.operations.entries()) {
      const operationId = `qop_acl_eq_${sequence}_${position}`;
      const commitId = `cmt_acl_eq_${sequence}_${position}`;
      await db.insert(busabaseCommits).values({
        id: commitId,
        spaceId: SPACE,
        operationId,
        payload: operation.payload ?? { name: `fixture ${sequence}` },
        operation: operation.operation ?? "record_create",
        author: OWNER,
      });
      await db.insert(busabaseOperations).values({
        id: operationId,
        spaceId: SPACE,
        changeRequestId,
        baseId: operation.baseId ?? null,
        nodeId: operation.nodeId ?? null,
        targetType: operation.nodeId || !operation.baseId ? "node" : "base",
        operation: operation.operation ?? "record_create",
        headCommitId: commitId,
        position,
      });
    }
    return changeRequestId;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-acl-eq-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-acl-eq-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    const db = await getDb();
    const root = rootNodeIdForSpace(SPACE);
    const fields = [{ slug: "name", name: "Name", type: "text" as const, options: {} }];

    // Another tenant, whose node and Base ids leak into this space's operations.
    const foreign = await asOtherSpaceOwner(async () => {
      await client.nodes.createChangeRequest({
        operations: [{ kind: "create", nodeType: "folder", slug: "foreign-folder", name: "F" }],
        autoMerge: true,
      });
      const base = await client.bases.create({
        slug: "foreign-base",
        name: "Foreign",
        fields,
        autoMerge: true,
      });
      if (!base.materialized) throw new Error("foreign base");
      const record = await client.bases.createChangeRequest({
        baseId: base.id,
        fields: { name: "foreign record" },
        autoMerge: true,
      });
      return {
        folderId: await nodeIdBySlug(OTHER_SPACE, "foreign-folder"),
        baseId: base.id,
        recordId: (record as { id: string }).id,
      };
    });
    const [foreignOperation] = await db
      .select({ id: busabaseOperations.id, headCommitId: busabaseOperations.headCommitId })
      .from(busabaseOperations)
      .where(eq(busabaseOperations.spaceId, OTHER_SPACE))
      .limit(1);
    if (!foreignOperation) throw new Error("foreign operation");

    const seeded = await asOwner(async () => {
      for (const slug of ["f-open", "f-private", "f-workspace", "f-public", "f-borrowed"]) {
        await client.nodes.createChangeRequest({
          operations: [{ kind: "create", nodeType: "folder", slug, name: slug }],
          autoMerge: true,
        });
      }
      const folders = {
        open: await nodeIdBySlug(SPACE, "f-open"),
        private: await nodeIdBySlug(SPACE, "f-private"),
        workspace: await nodeIdBySlug(SPACE, "f-workspace"),
        public: await nodeIdBySlug(SPACE, "f-public"),
      };
      const createBase = async (slug: string, parentNodeId?: string) => {
        const base = await client.bases.create({
          slug,
          name: slug,
          fields,
          autoMerge: true,
          ...(parentNodeId ? { parentNodeId } : {}),
        });
        if (!base.materialized || !base.nodeId) throw new Error(`base ${slug}`);
        return { id: base.id, nodeId: base.nodeId };
      };
      const bases = {
        open: await createBase("b-open", folders.open),
        private: await createBase("b-private", folders.private),
        granted: await createBase("b-granted", folders.private),
        spaceGrant: await createBase("b-space-grant", folders.private),
        workspace: await createBase("b-workspace", folders.workspace),
        public: await createBase("b-public", folders.public),
        root: await createBase("b-root"),
      };

      // Two merged records per Base; then one change request per status.
      const recordIds: Record<string, string> = {};
      for (const [key, base] of Object.entries(bases)) {
        for (let index = 0; index < 2; index++) {
          const record = await client.bases.createChangeRequest({
            baseId: base.id,
            fields: { name: `${key} record ${index}` },
            autoMerge: true,
          });
          recordIds[`${key}-${index}`] = (record as { id: string }).id;
        }
        for (const status of STATUSES) {
          const cr = await client.bases.createChangeRequest({
            baseId: base.id,
            fields: { name: `${key} ${status}` },
            autoMerge: false,
          });
          if (status === "merged") {
            await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
            await client.changeRequests.merge({ changeRequestIds: [cr.id] });
          } else if (status === "approved") {
            await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
          } else if (status === "changes_requested") {
            await client.changeRequests.review({
              changeRequestIds: [cr.id],
              verdict: "rejected",
              reason: "again",
            });
          } else if (status === "rejected") {
            await client.changeRequests.close({ changeRequestId: cr.id } as never);
          } else if (status !== "in_review") {
            await db
              .update(busabaseChangeRequests)
              .set({ status })
              .where(eq(busabaseChangeRequests.id, cr.id));
          }
        }
      }

      // Pending node creates: scope from the head commit, in operation order.
      await client.nodes.createChangeRequest({
        operations: [
          {
            kind: "create",
            nodeType: "folder",
            slug: "pending-open",
            name: "P",
            parentNodeId: folders.open,
          },
        ],
        autoMerge: false,
      });
      await client.nodes.createChangeRequest({
        operations: [
          {
            kind: "create",
            nodeType: "folder",
            slug: "pending-private",
            name: "P",
            parentNodeId: folders.private,
          },
        ],
        autoMerge: false,
      });
      await client.nodes.createChangeRequest({
        operations: [{ kind: "create", nodeType: "folder", slug: "pending-root", name: "P" }],
        autoMerge: false,
      });
      for (const [slug, parentNodeId] of [
        ["chain-private", folders.private],
        ["chain-open", folders.open],
      ] as const) {
        await client.nodes.createChangeRequest({
          operations: [
            { kind: "create", nodeType: "folder", slug, name: slug, parentNodeId, ref: slug },
            {
              kind: "create",
              nodeType: "folder",
              slug: `${slug}-child`,
              name: "child",
              parentNodeRef: slug,
            },
          ],
          autoMerge: false,
        });
      }
      // A rename names its node directly.
      await client.nodes.createChangeRequest({
        operations: [{ kind: "rename", nodeId: bases.private.nodeId, name: "renamed" }],
        autoMerge: false,
      } as never);

      return { folders, bases, recordIds };
    });
    const { folders, bases, recordIds } = seeded;
    openRecordId = recordIds["open-0"] ?? "";
    privateRecordId = recordIds["private-0"] ?? "";

    // Scopes the API cannot produce.
    const openCrId = await insertChangeRequest({
      rowBaseId: bases.open.id,
      operations: [{ baseId: bases.open.id }, { baseId: bases.private.id }],
    });
    await insertChangeRequest({
      rowBaseId: bases.open.id,
      status: "merged",
      operations: [{ baseId: bases.open.id }, { baseId: bases.public.id }],
    });
    await insertChangeRequest({ rowBaseId: bases.open.id, operations: [{ nodeId: root }] });
    await insertChangeRequest({
      rowBaseId: bases.open.id,
      operations: [{ nodeId: root }, { baseId: bases.workspace.id }],
    });
    await insertChangeRequest({
      rowBaseId: bases.open.id,
      operations: [{ nodeId: foreign.folderId }],
    });
    await insertChangeRequest({
      rowBaseId: bases.open.id,
      status: "merged",
      operations: [{ baseId: foreign.baseId }],
    });
    // A Base row of another space that points at a visible node of this one:
    // the change request scope must refuse it (Bases are space-scoped there),
    // while the record branch of the audit check joins Bases without a space.
    const borrowedBaseId = "bas_acl_eq_borrowed";
    await db.insert(busabaseBases).values({
      id: borrowedBaseId,
      spaceId: OTHER_SPACE,
      nodeId: await nodeIdBySlug(SPACE, "f-borrowed"),
      slug: "borrowed",
      name: "Borrowed",
    });
    await insertChangeRequest({
      rowBaseId: bases.open.id,
      operations: [{ baseId: borrowedBaseId }],
    });
    await insertChangeRequest({ rowBaseId: bases.open.id, operations: [] });
    await insertChangeRequest({ rowBaseId: bases.open.id, status: "merged", operations: [] });
    const ghostRefCrId = await insertChangeRequest({
      rowBaseId: bases.open.id,
      operations: [
        { operation: "node_create", payload: { parentNodeRef: "ghost", name: "g", slug: "g" } },
      ],
    });
    await insertChangeRequest({
      rowBaseId: bases.open.id,
      operations: [{ operation: "record_create", payload: { name: "no scope" } }],
    });
    await insertChangeRequest({
      rowBaseId: bases.open.id,
      operations: [
        { baseId: bases.open.id },
        {
          operation: "node_create",
          payload: { parentNodeId: folders.private, name: "h", slug: "h" },
        },
      ],
    });

    // ACL inputs.
    await asOwner(async () => {
      await client.nodes.updateVisibility({ nodeId: folders.private, visibility: "private" });
      await client.nodes.updateVisibility({ nodeId: folders.workspace, visibility: "workspace" });
      await client.nodes.updateVisibility({ nodeId: folders.public, visibility: "workspace" });
      await client.nodes.principals.add({
        nodeId: bases.granted.nodeId,
        principalType: "user",
        principalId: GRANTED,
        role: "read",
      });
      await client.nodes.principals.add({
        nodeId: bases.spaceGrant.nodeId,
        principalType: "space",
        principalId: SPACE,
        role: "read",
      });
      await setNodeShare(folders.public, { scope: "public", capability: "read" });
    });

    // Audit rows with every subject shape.
    const [openOperation] = await db
      .select()
      .from(busabaseOperations)
      .where(eq(busabaseOperations.changeRequestId, openCrId))
      .limit(1);
    const [privateOperation] = await db
      .select()
      .from(busabaseOperations)
      .where(
        and(eq(busabaseOperations.spaceId, SPACE), eq(busabaseOperations.baseId, bases.private.id)),
      )
      .limit(1);
    const [ghostOperation] = await db
      .select()
      .from(busabaseOperations)
      .where(eq(busabaseOperations.changeRequestId, ghostRefCrId))
      .limit(1);
    if (!openOperation || !privateOperation || !ghostOperation) throw new Error("operations");
    const orphanCommitId = "cmt_acl_eq_orphan";
    await db.insert(busabaseCommits).values({
      id: orphanCommitId,
      spaceId: SPACE,
      baseId: bases.open.id,
      operationId: null,
      payload: { name: "seeded" },
      author: OWNER,
    });
    const foreignOperationCommitId = "cmt_acl_eq_foreign_operation";
    await db.insert(busabaseCommits).values({
      id: foreignOperationCommitId,
      spaceId: SPACE,
      operationId: foreignOperation.id,
      payload: { name: "foreign" },
      author: OWNER,
    });
    // A record of this space under another space's Base.
    await db.insert(busabaseRecords).values({
      id: "rec_acl_eq_foreign_base",
      spaceId: SPACE,
      baseId: foreign.baseId,
      headCommitId: orphanCommitId,
      createdBy: OWNER,
    });
    await db.insert(busabaseRecords).values({
      id: "rec_acl_eq_borrowed_base",
      spaceId: SPACE,
      baseId: borrowedBaseId,
      headCommitId: orphanCommitId,
      createdBy: OWNER,
    });
    const tie = new Date("2026-11-08T10:00:00.000Z");
    const subjects: Partial<typeof busabaseAuditEvents.$inferInsert>[] = [
      {},
      { baseId: bases.open.id },
      { baseId: bases.private.id },
      { baseId: bases.granted.id },
      { baseId: foreign.baseId },
      { recordId: openRecordId },
      { recordId: privateRecordId },
      { recordId: recordIds["public-0"] },
      { recordId: "rec_acl_eq_foreign_base" },
      { recordId: "rec_acl_eq_borrowed_base" },
      { baseId: borrowedBaseId },
      { recordId: openRecordId, baseId: bases.private.id },
      { operationId: openOperation.id },
      { operationId: privateOperation.id },
      { operationId: ghostOperation.id },
      { operationId: foreignOperation.id, recordId: openRecordId },
      { operationId: foreignOperation.id },
      { commitId: privateOperation.headCommitId },
      { commitId: ghostOperation.headCommitId },
      { commitId: orphanCommitId, recordId: privateRecordId },
      { commitId: orphanCommitId, recordId: openRecordId },
      { commitId: orphanCommitId },
      { commitId: foreignOperationCommitId, recordId: openRecordId },
      { changeRequestId: openCrId },
      { changeRequestId: ghostRefCrId },
      { changeRequestId: privateOperation.changeRequestId, recordId: openRecordId },
    ];
    await db.insert(busabaseAuditEvents).values(
      subjects.map((subject, index) => ({
        id: `aud_acl_eq_${String(index).padStart(2, "0")}`,
        spaceId: SPACE,
        action: "record.viewed",
        actorId: OWNER,
        metadata: {},
        // Half of them share one timestamp, so the keyset has to break ties by id.
        createdAt: index % 2 === 0 ? tie : new Date(tie.getTime() + index * 1000),
        ...subject,
      })),
    );
    // Ties on change request activity timestamps too.
    const someChangeRequests = await db
      .select({ id: busabaseChangeRequests.id })
      .from(busabaseChangeRequests)
      .where(eq(busabaseChangeRequests.spaceId, SPACE))
      .limit(12);
    for (const row of someChangeRequests) {
      await db
        .update(busabaseChangeRequests)
        .set({ createdAt: tie, updatedAt: tie })
        .where(eq(busabaseChangeRequests.id, row.id));
    }

    actors = [
      { name: "owner", run: asOwner },
      {
        name: "manager through a read-only agent key",
        run: (fn) =>
          runWithBusabaseContext(
            {
              spaceId: SPACE,
              actorId: OWNER,
              isSpaceManager: true,
              permissionLevel: "manage",
              credentialPermissionCeiling: "read",
              agentSurface: true,
            },
            fn,
          ),
      },
      { name: "member", run: member(MEMBER) },
      { name: "member, restricted space", run: member(MEMBER, { restrictedVisibility: true }) },
      { name: "member with grants", run: member(GRANTED) },
      {
        name: "member with grants, restricted space",
        run: member(GRANTED, { restrictedVisibility: true }),
      },
      { name: "guest (read)", run: member(GUEST, { permissionLevel: "read" }) },
      {
        name: "agent key (write, read ceiling)",
        run: member(MEMBER, {
          agentSurface: true,
          credentialPermissionCeiling: "read",
          permissionLevelIsCeiling: true,
        }),
      },
      { name: "anonymous visitor", run: (fn) => runWithAnonymousContext({ spaceId: SPACE }, fn) },
      {
        name: "embed visitor",
        run: (fn) =>
          runWithEmbedContext(
            {
              spaceId: SPACE,
              actorId: "acl-embed",
              restrictedVisibility: true,
              embedTargetNodeId: bases.private.nodeId,
            },
            fn,
          ),
      },
    ];
  }, 600_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  // ── References: read everything, check every row, then page ────────────────

  const allChangeRequests = async () => {
    const db = await getDb();
    return db
      .select()
      .from(busabaseChangeRequests)
      .where(eq(busabaseChangeRequests.spaceId, SPACE))
      .orderBy(desc(busabaseChangeRequests.createdAt), desc(busabaseChangeRequests.id));
  };
  const encodeChangeRequestCursor = (createdAt: Date, id: string) =>
    Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64");
  // Match production: microsecond UTC key from Postgres, not JS Date.toISOString().
  const encodeActivityCursor = (tsKey: string, kind: string, id: string) =>
    Buffer.from(`${tsKey}|${kind}|${id}`, "utf8").toString("base64");

  const canRead = async (subject: Parameters<typeof assertAuditSubjectPermission>[0]) => {
    try {
      await assertAuditSubjectPermission(subject, "read");
      return true;
    } catch (error) {
      if (isAuditVisibilityMiss(error)) return false;
      throw error;
    }
  };

  const KIND_ORDER = { change_request: 3, operation: 2, record: 1, audit: 0 } as const;
  type Kind = keyof typeof KIND_ORDER;
  const referenceActivity = async (recordId?: string) => {
    const db = await getDb();
    const events: { ts: Date; tsKey: string; kind: Kind; id: string; visible: boolean }[] = [];
    const tsKeyOf = (col: typeof busabaseChangeRequests.updatedAt) =>
      sql<string>`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    if (!recordId) {
      for (const row of await db
        .select({
          ts: busabaseChangeRequests.updatedAt,
          tsKey: tsKeyOf(busabaseChangeRequests.updatedAt),
          id: busabaseChangeRequests.id,
        })
        .from(busabaseChangeRequests)
        .where(eq(busabaseChangeRequests.spaceId, SPACE))
        .orderBy(desc(busabaseChangeRequests.updatedAt), desc(busabaseChangeRequests.id))) {
        events.push({
          ...row,
          kind: "change_request",
          visible: await canRead({ changeRequestId: row.id, recordId: null, operationId: null }),
        });
      }
    }
    const operations = await db
      .select({
        ts: busabaseOperations.updatedAt,
        tsKey: tsKeyOf(busabaseOperations.updatedAt),
        id: busabaseOperations.id,
        changeRequestId: busabaseOperations.changeRequestId,
        targetRecordId: busabaseOperations.targetRecordId,
        sourceRecordId: busabaseOperations.sourceRecordId,
        mergedRecordId: busabaseOperations.mergedRecordId,
      })
      .from(busabaseOperations)
      .where(eq(busabaseOperations.spaceId, SPACE))
      .orderBy(desc(busabaseOperations.updatedAt), desc(busabaseOperations.id));
    for (const row of operations) {
      if (
        recordId &&
        ![row.targetRecordId, row.sourceRecordId, row.mergedRecordId].includes(recordId)
      ) {
        continue;
      }
      events.push({
        ts: row.ts,
        tsKey: row.tsKey,
        id: row.id,
        kind: "operation",
        visible: await canRead({
          changeRequestId: row.changeRequestId,
          operationId: row.id,
          recordId: null,
        }),
      });
    }
    if (!recordId) {
      for (const row of await db
        .select({
          ts: busabaseRecords.updatedAt,
          tsKey: tsKeyOf(busabaseRecords.updatedAt),
          id: busabaseRecords.id,
        })
        .from(busabaseRecords)
        .where(and(eq(busabaseRecords.spaceId, SPACE), eq(busabaseRecords.status, "active")))
        .orderBy(desc(busabaseRecords.updatedAt), desc(busabaseRecords.id))) {
        events.push({
          ...row,
          kind: "record",
          visible: await canRead({ recordId: row.id, changeRequestId: null, operationId: null }),
        });
      }
    }
    for (const row of await db
      .select({
        row: busabaseAuditEvents,
        tsKey: tsKeyOf(busabaseAuditEvents.createdAt),
      })
      .from(busabaseAuditEvents)
      .where(
        and(
          eq(busabaseAuditEvents.spaceId, SPACE),
          recordId ? eq(busabaseAuditEvents.recordId, recordId) : undefined,
        ),
      )
      .orderBy(desc(busabaseAuditEvents.createdAt), desc(busabaseAuditEvents.id))) {
      events.push({
        ts: row.row.createdAt,
        tsKey: row.tsKey,
        id: row.row.id,
        kind: "audit",
        visible: await canRead(row.row),
      });
    }
    // Match production: (tsKey DESC, kind DESC, id DESC).
    return events
      .filter((event) => event.visible)
      .sort(
        (a, b) =>
          (a.tsKey < b.tsKey ? 1 : a.tsKey > b.tsKey ? -1 : 0) ||
          KIND_ORDER[b.kind] - KIND_ORDER[a.kind] ||
          (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      );
  };

  const referenceAudit = async (limit: number) => {
    const db = await getDb();
    const rows = await db
      .select()
      .from(busabaseAuditEvents)
      .where(eq(busabaseAuditEvents.spaceId, SPACE))
      .orderBy(desc(busabaseAuditEvents.createdAt), desc(busabaseAuditEvents.id));
    const changeRequestIds = [...new Set(rows.flatMap((row) => row.changeRequestId ?? []))];
    const changeRequestRows = (await allChangeRequests()).filter((row) =>
      changeRequestIds.includes(row.id),
    );
    const visibleChangeRequests = new Set(
      (await filterVisibleChangeRequestRows(changeRequestRows)).map((row) => row.id),
    );
    const visible: string[] = [];
    for (const row of rows) {
      const ok = row.changeRequestId
        ? visibleChangeRequests.has(row.changeRequestId)
        : await canRead(row);
      if (ok) visible.push(row.id);
    }
    return visible.slice(0, limit);
  };

  const inboxCounts = (rows: { status: string; submittedBy: string }[], actorId: string) => ({
    review: rows.filter((row) => row.status === "in_review").length,
    changes: rows.filter((row) => row.status === "changes_requested").length,
    created: rows.filter((row) => row.submittedBy === actorId).length,
    approved: rows.filter((row) => row.status === "approved").length,
    merged: rows.filter((row) => row.status === "merged").length,
    rejected: rows.filter((row) => row.status === "rejected" || row.status === "abandoned").length,
  });

  // ── Assertions, per caller ──────────────────────────────────────────────────

  it(
    "the seed reaches every branch",
    async () => {
      const visibleCounts = new Map<string, number>();
      for (const actor of actors) {
        const rows = await actor.run(async () =>
          filterVisibleChangeRequestRows(await allChangeRequests()),
        );
        visibleCounts.set(actor.name, rows.length);
      }
      const total = (await allChangeRequests()).length;
      expect(visibleCounts.get("owner")).toBe(total);
      // Callers really differ: otherwise "equal results" would prove little.
      expect(new Set(visibleCounts.values()).size).toBeGreaterThanOrEqual(5);
      expect(visibleCounts.get("anonymous visitor")).toBeGreaterThan(0);
      expect(visibleCounts.get("anonymous visitor")).toBeLessThan(visibleCounts.get("member") ?? 0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "change request pages, inbox and badges match the per-row check for every caller",
    async () => {
      for (const actor of actors) {
        clearChangeRequestScopeCache();
        await actor.run(async () => {
          const visible = await filterVisibleChangeRequestRows(await allChangeRequests());
          const actorId =
            actor.name.startsWith("owner") || actor.name.startsWith("manager")
              ? OWNER
              : actor.name.includes("grants")
                ? GRANTED
                : actor.name.startsWith("guest")
                  ? GUEST
                  : MEMBER;
          const context = `${actor.name}`;

          expect(await countChangeRequests(), context).toEqual(
            inboxCounts(visible, actor.name.includes("visitor") ? "" : actorId),
          );
          expect((await countReviewChangeRequests()).review, context).toBe(
            visible.filter((row) => row.status === "in_review").length,
          );

          for (const status of [undefined, ["in_review"], ["merged"], ["rejected", "abandoned"]]) {
            const expected = visible.filter(
              (row) => !status || (status as string[]).includes(row.status),
            );
            // Keyset pages, with their cursors.
            const seen: string[] = [];
            let cursor: string | undefined;
            for (let page = 0; page < 200; page++) {
              const result = await listChangeRequestsPaged({ status, limit: 4, cursor } as never);
              seen.push(...result.changeRequests.map((cr) => cr.id));
              const last = expected[seen.length - 1];
              expect(result.nextCursor, `${context} cursor`).toBe(
                seen.length < expected.length && last
                  ? encodeChangeRequestCursor(last.createdAt, last.id)
                  : null,
              );
              if (!result.nextCursor) break;
              cursor = result.nextCursor;
            }
            expect(seen, `${context} keyset ${status}`).toEqual(expected.map((row) => row.id));

            // Numbered pages.
            const pageSize = 5;
            const totalPages = Math.ceil(expected.length / pageSize);
            for (let page = 1; page <= Math.max(totalPages, 1); page++) {
              const result = await listChangeRequestsPage({ status, page, pageSize } as never);
              expect(result.total, context).toBe(expected.length);
              expect(result.totalPages, context).toBe(totalPages);
              expect(
                result.changeRequests.map((cr) => cr.id),
                `${context} page ${page} ${status}`,
              ).toEqual(
                expected.slice((page - 1) * pageSize, page * pageSize).map((row) => row.id),
              );
              const snapshot = await getInboxSnapshot({ status, page, pageSize } as never);
              expect(snapshot.total, context).toBe(expected.length);
              expect(
                snapshot.changeRequests.map((cr) => cr.id),
                `${context} inbox page ${page} ${status}`,
              ).toEqual(
                expected.slice((page - 1) * pageSize, page * pageSize).map((row) => row.id),
              );
            }
          }
        });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the audit list matches the per-event check for every caller",
    async () => {
      for (const actor of actors) {
        clearChangeRequestScopeCache();
        await actor.run(async () => {
          for (const limit of [1, 7, 50, 100]) {
            const expected = await referenceAudit(limit);
            expect(
              (await listAuditEvents({ limit })).map((event) => event.id),
              `${actor.name} limit ${limit}`,
            ).toEqual(expected);
          }
        });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the activity feed matches the per-event check for every caller, page by page",
    async () => {
      const itemKey = (item: Awaited<ReturnType<typeof listActivityPaged>>["items"][number]) => {
        switch (item.kind) {
          case "change_request":
            return `change_request:${item.changeRequest.id}`;
          case "operation":
            return `operation:${item.operationId}`;
          case "record":
            return `record:${item.record.id}`;
          default:
            return `audit:${item.auditEvent.id}`;
        }
      };
      for (const actor of actors) {
        clearChangeRequestScopeCache();
        await actor.run(async () => {
          for (const recordId of [undefined, openRecordId, privateRecordId]) {
            const expected = await referenceActivity(recordId);
            if (recordId && !(await canRead({ recordId }))) {
              await expect(listActivityPaged({ limit: 5 }, recordId)).rejects.toBeTruthy();
              continue;
            }
            const limit = recordId ? 2 : 9;
            const seen: string[] = [];
            let cursor: string | undefined;
            for (let page = 0; page < 500; page++) {
              const result = await listActivityPaged({ limit, cursor }, recordId);
              seen.push(...result.items.map(itemKey));
              const last = expected[seen.length - 1];
              expect(result.nextCursor, `${actor.name} cursor`).toBe(
                seen.length < expected.length && last
                  ? encodeActivityCursor(last.tsKey, last.kind, last.id)
                  : null,
              );
              if (!result.nextCursor) break;
              cursor = result.nextCursor;
            }
            expect(seen, `${actor.name} activity ${recordId ?? "space"}`).toEqual(
              expected.map((event) => `${event.kind}:${event.id}`),
            );
          }
        });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
