import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithMemberContext } from "../src/context";
import { getDb } from "../src/db";
import { busabaseChangeRequests, busabaseCommits, busabaseOperations } from "../src/db/schema";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

/** The account a multi-tenant host (Busabase Cloud) authenticated for the request. */
const HOST_ACTOR = "usr_real_human";
/** What a caller claims — the AirApp SDK sends its `appId`, the CLI `--submitted-by`. */
const CLAIMED = "prd";

/**
 * Every change request and every commit it writes must be stamped with the
 * HOST's authenticated actor. The caller-supplied `submittedBy` / `author` is
 * only the open-source single-user default (see `resolveActorId`).
 *
 * Several paths got this wrong, and it showed up in two places on Cloud:
 * - `submitted_by` — the team-insights leaderboard listed app ids such as
 *   `prd` as members of the space;
 * - commit `author` — the record view's "Commit author" read `producer` (a
 *   hardcoded open-source placeholder) for every created record, and the
 *   caller's string for everything else. In one production space, 0 of 143
 *   records showed a real person there.
 */
describe("change request attribution", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let nameFieldId = "";
  let noteFieldId = "";
  let viewId = "";
  let driveNodeId = "";

  const asHost = <T>(fn: () => Promise<T>) => runWithMemberContext({ actorId: HOST_ACTOR }, fn);

  /** The change request's own `submitted_by`, and the author of every commit it carries. */
  const attributionOf = async (changeRequestId: string) => {
    const db = await getDb();
    const [changeRequest] = await db
      .select({ submittedBy: busabaseChangeRequests.submittedBy })
      .from(busabaseChangeRequests)
      .where(eq(busabaseChangeRequests.id, changeRequestId));
    const operations = await db
      .select({ headCommitId: busabaseOperations.headCommitId })
      .from(busabaseOperations)
      .where(eq(busabaseOperations.changeRequestId, changeRequestId));
    const commitIds = operations
      .map((operation) => operation.headCommitId)
      .filter((commitId): commitId is string => Boolean(commitId));
    const commits = commitIds.length
      ? await db
          .select({ author: busabaseCommits.author })
          .from(busabaseCommits)
          .where(inArray(busabaseCommits.id, commitIds))
      : [];
    return {
      submittedBy: changeRequest?.submittedBy,
      commitAuthors: commits.map((commit) => commit.author),
    };
  };

  const expectHostAttribution = async (changeRequestId: string) => {
    const { submittedBy, commitAuthors } = await attributionOf(changeRequestId);
    expect(submittedBy).toBe(HOST_ACTOR);
    expect(commitAuthors.length).toBeGreaterThan(0);
    expect(new Set(commitAuthors)).toEqual(new Set([HOST_ACTOR]));
  };

  const merge = async (changeRequestId: string) => {
    await client.changeRequests.review({
      changeRequestIds: [changeRequestId],
      verdict: "approved",
    });
    const [result] = (await client.changeRequests.merge({ changeRequestIds: [changeRequestId] }))
      .results;
    if (!result?.ok) throw new Error(result?.error ?? "merge failed");
  };

  /** A record created and merged in local mode, for the paths that need one to exist. */
  const seedRecord = async (name: string) => {
    const created = await client.bases.createChangeRequest({
      baseId,
      fields: { name },
      autoMerge: true,
    });
    if (!created.materialized) throw new Error("expected a materialized record");
    return created.id;
  };

  /** Add a field in local mode and return its id, for the cases that need their own. */
  const seedField = async (slug: string) => {
    await client.bases.fieldChangeRequest({
      operation: "create",
      baseId,
      slug,
      name: slug,
      type: "text",
      autoMerge: true,
    });
    const detail = await client.bases.get({ baseId });
    const fieldId = detail.fields.find((field) => field.slug === slug)?.id;
    if (!fieldId) throw new Error(`field ${slug} was not created`);
    return fieldId;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-cr-attribution-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-cr-attribution-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "attribution-base",
      name: "Attribution Base",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "note", name: "Note", type: "text", options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;
    const detail = await client.bases.get({ baseId });
    nameFieldId = detail.fields.find((field) => field.slug === "name")?.id ?? "";
    noteFieldId = detail.fields.find((field) => field.slug === "note")?.id ?? "";
    // A new Base starts with no views, so make the one the view cases edit.
    const view = await client.views.changeRequest({
      operation: "create",
      baseId,
      name: "Grid",
      autoMerge: true,
    });
    viewId = (view as { id: string }).id;

    const drive = await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      slug: "attribution-drive",
      name: "Attribution Drive",
      files: [{ path: "notes/today.md", content: "today\n" }],
    });
    driveNodeId = drive.node.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("has the fixtures the cases below rely on", () => {
    expect(nameFieldId).not.toBe("");
    expect(noteFieldId).not.toBe("");
    expect(viewId).not.toBe("");
  });

  describe("proposals are attributed to the host actor, not the caller's string", () => {
    it("file tree: update", async () => {
      const cr = await asHost(() =>
        client.fileTrees.createChangeRequest({
          type: "drive",
          nodeId: driveNodeId,
          autoMerge: false,
          submittedBy: CLAIMED,
          operations: [{ kind: "update", path: "notes/today.md", content: "from an app\n" }],
        }),
      );
      expect(cr.submittedBy).toBe(HOST_ACTOR);
      await expectHostAttribution(cr.id);
    });

    it("file tree: cannot be attributed to somebody else", async () => {
      const cr = await asHost(() =>
        client.fileTrees.createChangeRequest({
          type: "drive",
          nodeId: driveNodeId,
          autoMerge: false,
          submittedBy: "usr_somebody_else",
          operations: [{ kind: "update", path: "notes/today.md", content: "not me\n" }],
        }),
      );
      await expectHostAttribution(cr.id);
    });

    it("record: create (was the hardcoded `producer`)", async () => {
      const cr = await asHost(() =>
        client.bases.createChangeRequest({
          baseId,
          fields: { name: "Created by an app" },
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      if (cr.materialized) throw new Error("expected a pending change request");
      await expectHostAttribution(cr.id);
    });

    it("record: bulk create (was the hardcoded `producer`)", async () => {
      const cr = await asHost(() =>
        client.bases.createBulkChangeRequest({
          baseId,
          records: [{ name: "Bulk one" }, { name: "Bulk two" }],
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      await expectHostAttribution((cr as { id: string }).id);
    });

    it("record: update", async () => {
      const recordId = await seedRecord("To update");
      const cr = await asHost(() =>
        client.records.changeRequest({
          recordId,
          operation: "update",
          fields: { note: "edited by an app" },
          author: CLAIMED,
          autoMerge: false,
        }),
      );
      await expectHostAttribution(cr.id);
    });

    it("record: delete (was the hardcoded `producer`)", async () => {
      const recordId = await seedRecord("To delete");
      const cr = await asHost(() =>
        client.records.changeRequest({
          recordId,
          operation: "delete",
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      await expectHostAttribution(cr.id);
    });

    it("record: restore (was the hardcoded `producer`)", async () => {
      const recordId = await seedRecord("To restore");
      await client.records.changeRequest({ recordId, operation: "delete", autoMerge: true });
      const cr = await asHost(() =>
        client.records.changeRequest({
          recordId,
          operation: "restore",
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      await expectHostAttribution(cr.id);
    });

    it("record: revise a pending update", async () => {
      const recordId = await seedRecord("To revise");
      const cr = await asHost(() =>
        client.records.changeRequest({
          recordId,
          operation: "update",
          fields: { note: "first draft" },
          autoMerge: false,
        }),
      );
      const detail = await client.changeRequests.get({ changeRequestId: cr.id });
      const operationId = detail.operations[0]?.id ?? "";
      // Revising writes a NEW head commit for the operation; a raw `author`
      // would land on it even though the proposal itself was attributed right.
      await asHost(() =>
        client.operations.revise({
          operationId,
          fields: { name: "To revise", note: "revised by an app" },
          author: "usr_somebody_else",
        }),
      );
      await expectHostAttribution(cr.id);
    });

    it("field: create", async () => {
      const cr = await asHost(() =>
        client.bases.fieldChangeRequest({
          operation: "create",
          baseId,
          slug: "added_by_app",
          name: "Added by app",
          type: "text",
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      await expectHostAttribution((cr as { id: string }).id);
    });

    it("field: update", async () => {
      const cr = await asHost(() =>
        client.bases.fieldChangeRequest({
          operation: "update",
          baseId,
          fieldId: noteFieldId,
          patch: { name: "Note (renamed by app)" },
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      await expectHostAttribution((cr as { id: string }).id);
    });

    it("field: delete", async () => {
      const cr = await asHost(() =>
        client.bases.fieldChangeRequest({
          operation: "delete",
          baseId,
          fieldId: noteFieldId,
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      await expectHostAttribution((cr as { id: string }).id);
    });

    it("field: reorder", async () => {
      const cr = await asHost(() =>
        client.bases.fieldChangeRequest({
          operation: "reorder",
          baseId,
          fieldIds: [noteFieldId, nameFieldId],
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      await expectHostAttribution((cr as { id: string }).id);
    });

    it("field: convert", async () => {
      const fieldId = await seedField("to_convert");
      const cr = await asHost(() =>
        client.bases.fieldChangeRequest({
          operation: "convert",
          baseId,
          fieldId,
          newType: "longtext",
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      await expectHostAttribution((cr as { id: string }).id);
    });

    it("field: restore", async () => {
      const fieldId = await seedField("to_restore");
      await client.bases.fieldChangeRequest({
        operation: "delete",
        baseId,
        fieldId,
        autoMerge: true,
      });
      const cr = await asHost(() =>
        client.bases.fieldChangeRequest({
          operation: "restore",
          baseId,
          fieldId,
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      await expectHostAttribution((cr as { id: string }).id);
    });

    it("view: create", async () => {
      const cr = await asHost(() =>
        client.views.changeRequest({
          operation: "create",
          baseId,
          name: "App view",
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      await expectHostAttribution((cr as { id: string }).id);
    });

    it("view: update", async () => {
      const cr = await asHost(() =>
        client.views.changeRequest({
          operation: "update",
          viewId,
          name: "Renamed by app",
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      await expectHostAttribution((cr as { id: string }).id);
    });

    it("view: delete", async () => {
      const cr = await asHost(() =>
        client.views.changeRequest({
          operation: "delete",
          viewId,
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      await expectHostAttribution((cr as { id: string }).id);
    });

    it("view: restore", async () => {
      const view = await client.views.changeRequest({
        operation: "create",
        baseId,
        name: "To restore",
        autoMerge: true,
      });
      const restoreViewId = (view as { id: string }).id;
      await client.views.changeRequest({
        operation: "delete",
        viewId: restoreViewId,
        autoMerge: true,
      });
      const cr = await asHost(() =>
        client.views.changeRequest({
          operation: "restore",
          viewId: restoreViewId,
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      await expectHostAttribution((cr as { id: string }).id);
    });

    it("base: restore", async () => {
      const archived = await client.bases.create({
        slug: "attribution-archived-base",
        name: "Archived Base",
        fields: [{ slug: "name", name: "Name", type: "text", options: {} }],
        autoMerge: true,
      });
      await client.bases.lifecycleChangeRequest({
        operation: "archive",
        baseId: archived.id,
        autoMerge: true,
      });
      const cr = await asHost(() =>
        client.bases.lifecycleChangeRequest({
          operation: "restore",
          baseId: archived.id,
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      await expectHostAttribution((cr as { id: string }).id);
    });

    it("base: archive", async () => {
      const cr = await asHost(() =>
        client.bases.lifecycleChangeRequest({
          operation: "archive",
          baseId,
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      await expectHostAttribution((cr as { id: string }).id);
    });
  });

  describe("what the record view renders", () => {
    it("names the host actor as the Commit author of a record created through a change request", async () => {
      const created = await asHost(() =>
        client.bases.createChangeRequest({
          baseId,
          fields: { name: "Shown in the record view" },
          submittedBy: CLAIMED,
          autoMerge: false,
        }),
      );
      if (created.materialized) throw new Error("expected a pending change request");
      await merge(created.id);
      const detail = await client.changeRequests.get({ changeRequestId: created.id });
      const recordId = detail.operations[0]?.mergedRecordId ?? "";
      const record = await client.records.get({ recordId });
      expect(record.headCommit.author).toBe(HOST_ACTOR);
    });

    it("names the host actor as the Commit author after an update merges", async () => {
      const recordId = await seedRecord("Updated in the record view");
      const cr = await asHost(() =>
        client.records.changeRequest({
          recordId,
          operation: "update",
          fields: { name: "Updated in the record view", note: "merged" },
          author: CLAIMED,
          autoMerge: false,
        }),
      );
      await merge(cr.id);
      const record = await client.records.get({ recordId });
      expect(record.headCommit.author).toBe(HOST_ACTOR);
    });
  });

  describe("open-source local mode (no host actor) keeps its placeholders", () => {
    it("file tree keeps the caller's value", async () => {
      const cr = await client.fileTrees.createChangeRequest({
        type: "drive",
        nodeId: driveNodeId,
        autoMerge: false,
        submittedBy: "local-producer",
        operations: [{ kind: "update", path: "notes/today.md", content: "local\n" }],
      });
      expect(cr.submittedBy).toBe("local-producer");
    });

    it("record create keeps the `producer` commit author", async () => {
      const cr = await client.bases.createChangeRequest({
        baseId,
        fields: { name: "Local create" },
        autoMerge: false,
      });
      if (cr.materialized) throw new Error("expected a pending change request");
      const { commitAuthors } = await attributionOf(cr.id);
      expect(new Set(commitAuthors)).toEqual(new Set(["producer"]));
    });
  });
});
