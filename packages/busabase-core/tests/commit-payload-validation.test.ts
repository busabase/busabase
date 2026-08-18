import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import { busabaseCommits, busabaseOperationKindEnum } from "../src/db/schema";
import {
  COMMIT_PAYLOAD_SCHEMAS,
  CommitPayloadError,
  parseCommitPayload,
} from "../src/logic/commit-payload-schemas";
import { insertCommit } from "../src/logic/commits";

/**
 * `busabase_commits.payload` is a discriminated union stored as untyped jsonb,
 * discriminated by the sibling `operation` enum column. Until now nothing
 * validated it: every merge handler simply cast, so a malformed commit was only
 * discovered at merge time, arbitrarily far from where it was created.
 *
 * These tests pin the two halves of the fix against a real Postgres (PGlite),
 * not mocks:
 *
 *   1. WRITE — `insertCommit` refuses a malformed payload, and nothing lands in
 *      the table. This is what makes "a bad payload cannot enter the ledger" a
 *      structural property rather than per-call-site discipline.
 *   2. MERGE — `parseCommitPayload` accepts what the write path produced and
 *      returns it typed, and rejects a corrupt row loudly.
 *
 * Plus the exhaustiveness guarantee: every operation kind the database enum can
 * store has a schema. If someone adds an enum member and forgets the schema,
 * `insertCommit` would throw at runtime for that kind — this test says so up
 * front instead.
 */
describe("commit payload validation (real PGlite)", () => {
  let dataDir = "";
  let originalCwd = "";
  const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

  const asManager = <T>(fn: () => Promise<T>) =>
    runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, actorId: "alice", isSpaceManager: true }, fn);

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-commit-payload-db-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("has a schema for every operation kind the column can hold", () => {
    const enumKinds = [...busabaseOperationKindEnum.enumValues].sort();
    const schemaKinds = Object.keys(COMMIT_PAYLOAD_SCHEMAS).sort();
    expect(schemaKinds).toEqual(enumKinds);
  });

  // ── WRITE PATH ─────────────────────────────────────────────────────────────

  it("insertCommit REJECTS a malformed payload and writes nothing", async () => {
    await asManager(async () => {
      const db = await getDb();
      const commitId = "cmt_malformed_probe";

      // `doc_update` must carry a string `body`. A number is exactly the kind of
      // shape that used to sail into the table and only explode at merge.
      await expect(
        insertCommit(db, {
          id: commitId,
          baseId: null,
          targetType: "node",
          nodeId: null,
          operationId: null,
          parentCommitId: null,
          payload: { body: 42 },
          operation: "doc_update",
          message: "malformed doc body",
          author: "alice",
          createdAt: new Date(),
        }),
      ).rejects.toBeInstanceOf(CommitPayloadError);

      // The point of validating on write: no row exists to be found later.
      const rows = await db
        .select({ id: busabaseCommits.id })
        .from(busabaseCommits)
        .where(eq(busabaseCommits.id, commitId));
      expect(rows).toHaveLength(0);
    });
  });

  it("insertCommit's error names the operation and the offending path", async () => {
    await asManager(async () => {
      const db = await getDb();
      const error = await insertCommit(db, {
        id: "cmt_missing_field_id",
        baseId: null,
        targetType: "base",
        nodeId: null,
        operationId: null,
        parentCommitId: null,
        // `base_convert_field`'s merge handler indexes `fieldId`/`fromType`/
        // `newType`; omitting them used to produce a null-ish crash at merge.
        payload: { slug: "title" },
        operation: "base_convert_field",
        message: "convert without a target",
        author: "alice",
        createdAt: new Date(),
      }).catch((e: unknown) => e as CommitPayloadError);

      expect(error).toBeInstanceOf(CommitPayloadError);
      expect(error.message).toContain("base_convert_field");
      expect(error.message).toContain("fieldId");
    });
  });

  it("insertCommit ACCEPTS a well-formed payload and stores it verbatim", async () => {
    await asManager(async () => {
      const db = await getDb();
      const commitId = "cmt_wellformed_probe";
      // A superset payload: `node_rename` is written as the whole contract
      // operation variant, so `kind`/`nodeId` ride along beyond what the merge
      // handler reads. Validation must keep them, not strip them — this is an
      // append-only ledger.
      const payload = {
        kind: "rename" as const,
        nodeId: "nod_probe",
        slug: "renamed-slug",
        name: "Renamed",
        description: "why it was renamed",
      };

      await insertCommit(db, {
        id: commitId,
        baseId: null,
        targetType: "node",
        nodeId: null,
        operationId: null,
        parentCommitId: null,
        payload,
        operation: "node_rename",
        message: "rename a node",
        author: "alice",
        createdAt: new Date(),
      });

      const [row] = await db
        .select({ payload: busabaseCommits.payload })
        .from(busabaseCommits)
        .where(eq(busabaseCommits.id, commitId));
      expect(row?.payload).toEqual(payload);
    });
  });

  // ── MERGE PATH ─────────────────────────────────────────────────────────────

  it("parseCommitPayload reads back what the write path stored, typed", async () => {
    await asManager(async () => {
      const db = await getDb();
      const [row] = await db
        .select({ payload: busabaseCommits.payload, operation: busabaseCommits.operation })
        .from(busabaseCommits)
        .where(eq(busabaseCommits.id, "cmt_wellformed_probe"));
      expect(row).toBeTruthy();

      const parsed = parseCommitPayload("node_rename", row?.payload);
      // Typed access, no `as` cast — this is the whole point of the change.
      expect(parsed.slug).toBe("renamed-slug");
      expect(parsed.name).toBe("Renamed");
      // The unread-by-merge keys survive the round trip.
      expect(parsed.nodeId).toBe("nod_probe");
    });
  });

  it("parseCommitPayload throws a named error on a corrupt row", () => {
    const error = (() => {
      try {
        parseCommitPayload("base_reorder_fields", { fieldIds: "not-an-array" });
        return null;
      } catch (e) {
        return e as CommitPayloadError;
      }
    })();

    expect(error).toBeInstanceOf(CommitPayloadError);
    expect(error?.message).toContain("base_reorder_fields");
    expect(error?.message).toContain("fieldIds");
  });

  it("parseCommitPayload rejects an operation kind with no registered schema", () => {
    expect(() =>
      // Cast: the point is what happens when an unregistered kind reaches this
      // at runtime (e.g. a row written by a future/rolled-back deploy).
      parseCommitPayload("totally_unknown_kind" as never, { anything: true }),
    ).toThrow(/unknown operation kind/);
  });
});
