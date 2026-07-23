import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { subscribeRealtimeMessages } from "openlib/realtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID } from "../src/context";
import { getDb } from "../src/db";
import { busabaseChangeRequests, busabaseCommits, busabaseOperations } from "../src/db/schema";
import { getBusabaseOpenApiSpec } from "../src/openapi/spec";
import { busabaseRouter } from "../src/router";

/**
 * Regression coverage for three related bug fixes, all driven through the real
 * oRPC router (input + contract output validation included, not bare handler
 * calls):
 *
 * 1. Parent-node type validation (`createFileTreeNode`/`createFileNode`/
 *    `createBase`/`createDoc` + `mergeNodeCreate`/`mergeNodeMove`) used to throw
 *    a plain `Error` when the resolved parent existed but wasn't container-capable
 *    (e.g. nesting under a Base), which the oRPC OpenAPIHandler can't map to a
 *    specific HTTP status and falls back to 500. It now throws a structured
 *    `ORPCError("INVALID_PARENT_NODE_TYPE", { status: 422 })` via the shared
 *    `assertContainerParent` helper (`src/logic/node-parent.ts`).
 * 2. Every create-endpoint response (`airapps`/`skills`/`drives`/`files`/`docs`/
 *    `bases`) now includes `materialized: boolean` so a caller can tell, without
 *    inspecting the response shape, whether the result is a live node
 *    (`materialized: true`) or a pending review-first ChangeRequest proposing one
 *    (`materialized: false`).
 * 3. `createChangeRequest`/`createBulkChangeRequest` no longer let an unrelated
 *    live-event/notification failure turn an already-committed write into a false
 *    500 (`publishChangeRequestPendingReview` in `src/logic/live-events.ts`), and
 *    both now accept an optional `idempotencyKey` so a retry (e.g. after that
 *    kind of false failure, or a timeout) returns the original ChangeRequest
 *    instead of creating a content-identical duplicate.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("Node-parent validation, materialized flag, and ChangeRequest safety — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let baseNodeId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-node-parent-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-node-parent-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "leads",
      name: "Leads",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
      autoMerge: true,
    });
    baseId = base.id;
    baseNodeId = base.nodeId;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  describe("Fix 1 — parent-node type validation returns a structured 422, not a 500", () => {
    it("rejects creating an AirApp under a Base node with INVALID_PARENT_NODE_TYPE / 422", async () => {
      await expect(
        client.airapps.create({
          autoMerge: true,
          slug: "under-a-base",
          name: "Under Base",
          parentNodeId: baseNodeId,
        }),
      ).rejects.toMatchObject({ code: "INVALID_PARENT_NODE_TYPE", status: 422 });
    });

    it("rejects creating a Base under another Base node too — proves the shared helper covers createBase, not just the filetree family", async () => {
      await expect(
        client.bases.create({
          slug: "nested-under-base",
          name: "Nested Under Base",
          fields: [],
          autoMerge: true,
          parentNodeId: baseNodeId,
        }),
      ).rejects.toMatchObject({ code: "INVALID_PARENT_NODE_TYPE", status: 422 });
    });

    it("still 404s a genuinely unknown parentNodeId — distinct from the wrong-type 422", async () => {
      await expect(
        client.airapps.create({
          autoMerge: true,
          slug: "missing-parent",
          name: "Missing Parent",
          parentNodeId: "nod_does_not_exist",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("documents the parentNodeId container constraint in the generated OpenAPI spec", async () => {
      const spec = await getBusabaseOpenApiSpec();
      const airappsPath = JSON.stringify(spec.paths?.["/api/v1/airapps"] ?? {});
      const filesPath = JSON.stringify(spec.paths?.["/api/v1/files"] ?? {});
      expect(airappsPath).toContain("container-incapable node types");
      expect(filesPath).toContain("container-incapable node types");
    });
  });

  describe("Fix 2 — materialized flag on create-endpoint responses", () => {
    it("airapps.create: materialized true when autoMerge, false when review-first", async () => {
      const created = await client.airapps.create({
        autoMerge: true,
        slug: "mat-airapp",
        name: "Mat AirApp",
      });
      expect(created.materialized).toBe(true);

      const pending = await client.airapps.create({
        slug: "pending-airapp",
        name: "Pending AirApp",
        autoMerge: false,
      });
      expect(pending.materialized).toBe(false);
      expect(pending.status).toBe("in_review");
    });

    it("the idempotent existing-slug-match branch also reports materialized: true", async () => {
      const first = await client.airapps.create({
        autoMerge: true,
        slug: "dup-slug-airapp",
        name: "Dup Slug",
      });
      const again = await client.airapps.create({
        autoMerge: true,
        slug: "dup-slug-airapp",
        name: "Dup Slug",
      });
      expect(again.materialized).toBe(true);
      expect(again.node.id).toBe(first.node.id);
    });

    it("bases.create: materialized true when autoMerge, false when review-first", async () => {
      const created = await client.bases.create({
        slug: "mat-base",
        name: "Mat Base",
        fields: [],
        autoMerge: true,
      });
      expect(created.materialized).toBe(true);

      const pending = await client.bases.create({
        slug: "pending-base",
        name: "Pending Base",
        fields: [],
        autoMerge: false,
      });
      expect(pending.materialized).toBe(false);
      expect(pending.status).toBe("in_review");
    });

    it("docs.create: materialized true when autoMerge, false when review-first", async () => {
      const created = await client.docs.create({
        slug: "mat-doc",
        name: "Mat Doc",
        body: "hello\n",
        autoMerge: true,
      });
      expect(created.materialized).toBe(true);

      const pending = await client.docs.create({
        slug: "pending-doc",
        name: "Pending Doc",
        body: "hi\n",
        autoMerge: false,
      });
      expect(pending.materialized).toBe(false);
      expect(pending.status).toBe("in_review");
    });

    it("files.create: materialized true when autoMerge, false when review-first", async () => {
      const hash = `sha256:${"9".repeat(64)}`;
      const req = await client.assets.createUploadUrl({
        fileName: "note.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
        contentHash: hash,
        context: "file-node",
      });
      const confirmed = await client.assets.confirm({
        storageKey: req.storageKey,
        fileName: "note.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
        contentHash: hash,
        context: "file-node",
      });

      const created = await client.files.create({
        autoMerge: true,
        slug: "mat-file",
        name: "Mat File",
        assetId: confirmed.assetId as string,
      });
      expect(created.materialized).toBe(true);

      const pending = await client.files.create({
        slug: "pending-file",
        name: "Pending File",
        assetId: confirmed.assetId as string,
        autoMerge: false,
      });
      expect(pending.materialized).toBe(false);
      expect(pending.status).toBe("in_review");
    });
  });

  describe("Fix 3 — post-commit exception safety + idempotency key", () => {
    it("createChangeRequest still succeeds and persists CR/operation/commit rows even when the live-event publish throws", async () => {
      const channel = `busabase:live:${LOCAL_SPACE_ID}`;
      const unsubscribe = subscribeRealtimeMessages(channel, () => {
        throw new Error("simulated live-event subscriber failure");
      });
      try {
        const cr = await client.bases.createChangeRequest({
          baseId,
          fields: { name: "Boom Co" },
          message: "trigger boom",
          autoMerge: false,
        });
        expect(cr.status).toBe("in_review");

        // Not just "no exception thrown" — actually query the DB to prove the
        // rows are durably persisted, per this repo's verification convention.
        const db = await getDb();
        const [crRow] = await db
          .select()
          .from(busabaseChangeRequests)
          .where(eq(busabaseChangeRequests.id, cr.id))
          .limit(1);
        expect(crRow).toBeDefined();

        const opRows = await db
          .select()
          .from(busabaseOperations)
          .where(eq(busabaseOperations.changeRequestId, cr.id));
        expect(opRows.length).toBe(1);

        const headCommitId = opRows[0]?.headCommitId;
        expect(headCommitId).toBeTruthy();
        const [commitRow] = await db
          .select()
          .from(busabaseCommits)
          .where(eq(busabaseCommits.id, headCommitId as string))
          .limit(1);
        expect(commitRow).toBeDefined();
      } finally {
        unsubscribe();
      }
    });

    it("dedupes createChangeRequest retries with the same idempotencyKey", async () => {
      const first = await client.bases.createChangeRequest({
        baseId,
        fields: { name: "Idempotent Co" },
        message: "m",
        idempotencyKey: "retry-key-1",
        autoMerge: false,
      });
      const second = await client.bases.createChangeRequest({
        baseId,
        fields: { name: "Idempotent Co (retry payload differs, still deduped)" },
        message: "m (retry)",
        idempotencyKey: "retry-key-1",
        autoMerge: false,
      });
      expect(second.id).toBe(first.id);

      const db = await getDb();
      const rows = await db
        .select()
        .from(busabaseChangeRequests)
        .where(
          and(
            eq(busabaseChangeRequests.baseId, baseId),
            eq(busabaseChangeRequests.idempotencyKey, "retry-key-1"),
          ),
        );
      expect(rows.length).toBe(1);
    });

    it("does not dedupe distinct or omitted idempotencyKeys", async () => {
      const a = await client.bases.createChangeRequest({
        baseId,
        fields: { name: "Key A" },
        message: "m",
        idempotencyKey: "key-a",
      });
      const b = await client.bases.createChangeRequest({
        baseId,
        fields: { name: "Key B" },
        message: "m",
        idempotencyKey: "key-b",
      });
      expect(a.id).not.toBe(b.id);

      const c = await client.bases.createChangeRequest({
        baseId,
        fields: { name: "No Key C" },
        message: "m",
      });
      const d = await client.bases.createChangeRequest({
        baseId,
        fields: { name: "No Key D" },
        message: "m",
      });
      expect(c.id).not.toBe(d.id);
    });

    it("resolves a concurrent duplicate-idempotencyKey race to a single ChangeRequest (not two)", async () => {
      const key = "race-key-1";
      const [a, b] = await Promise.all([
        client.bases.createChangeRequest({
          baseId,
          fields: { name: "Race" },
          message: "m",
          idempotencyKey: key,
          autoMerge: false,
        }),
        client.bases.createChangeRequest({
          baseId,
          fields: { name: "Race" },
          message: "m",
          idempotencyKey: key,
          autoMerge: false,
        }),
      ]);
      expect(a.id).toBe(b.id);

      const db = await getDb();
      const rows = await db
        .select()
        .from(busabaseChangeRequests)
        .where(
          and(
            eq(busabaseChangeRequests.baseId, baseId),
            eq(busabaseChangeRequests.idempotencyKey, key),
          ),
        );
      expect(rows.length).toBe(1);
    });

    it("dedupes createBulkChangeRequest retries with the same idempotencyKey", async () => {
      const first = await client.bases.createBulkChangeRequest({
        baseId,
        records: [{ name: "Bulk Retry 1" }],
        message: "m",
        idempotencyKey: "bulk-retry-1",
      });
      const second = await client.bases.createBulkChangeRequest({
        baseId,
        records: [{ name: "Bulk Retry 1" }],
        message: "m",
        idempotencyKey: "bulk-retry-1",
      });
      expect(second.id).toBe(first.id);

      const db = await getDb();
      const rows = await db
        .select()
        .from(busabaseChangeRequests)
        .where(
          and(
            eq(busabaseChangeRequests.baseId, baseId),
            eq(busabaseChangeRequests.idempotencyKey, "bulk-retry-1"),
          ),
        );
      expect(rows.length).toBe(1);
    });
  });
});
