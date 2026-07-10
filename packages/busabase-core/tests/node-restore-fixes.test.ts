import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Regression tests for two node/field restore defects:
 *  - A: trashing then restoring a base node must NOT resurrect records the user
 *       had deleted individually (record archive/restore is timestamp-scoped).
 *  - C: restoring a soft-deleted field whose slug was reused is rejected, instead
 *       of leaving two active fields with the same slug.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("node / field restore fixes", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-noderestore-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-noderestore-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const approveAndMerge = (changeRequestId: string) =>
    client.changeRequests
      .review({ changeRequestId, verdict: "approved" })
      .then(() => client.changeRequests.merge({ changeRequestId }));

  // ── A: node trash/restore preserves individually-deleted records ───────────
  it("restoring a trashed base does not resurrect a record deleted individually (#A)", async () => {
    const base = await client.bases.create({
      autoMerge: true,
      slug: "trash-restore",
      name: "Trash Restore",
      fields: [{ slug: "title", name: "Title", type: "text", required: true }],
    });
    const baseId = base.id;
    const nodeId = base.nodeId;

    const r1 = (
      await approveAndMerge(
        (
          await client.bases.createChangeRequest({ baseId, fields: { title: "keep-deleted" } })
        ).id,
      )
    ).record!.id;
    const r2 = (
      await approveAndMerge(
        (
          await client.bases.createChangeRequest({ baseId, fields: { title: "should-return" } })
        ).id,
      )
    ).record!.id;

    // Delete r1 individually (archive), leave r2 active.
    await approveAndMerge(
      (await client.records.deleteChangeRequest({ recordId: r1, deleteMode: "archive" })).id,
    );
    expect((await client.records.get({ recordId: r1 }))?.status).toBe("archived");

    // Trash the whole base node, then restore it.
    await approveAndMerge(
      (await client.nodes.createChangeRequest({ operations: [{ kind: "delete", nodeId }] })).id,
    );
    expect((await client.bases.list()).some((b) => b.id === baseId)).toBe(false);

    await approveAndMerge(
      (await client.nodes.createChangeRequest({ operations: [{ kind: "restore", nodeId }] })).id,
    );

    // The base is back, r2 is active again, but r1 stays deleted.
    expect((await client.bases.list()).some((b) => b.id === baseId)).toBe(true);
    expect((await client.records.get({ recordId: r2 }))?.status).toBe("active");
    expect((await client.records.get({ recordId: r1 }))?.status).toBe("archived");
  });

  // ── C: field restore rejected when its slug was reused ─────────────────────
  it("restoring a field whose slug was reused is rejected (#C)", async () => {
    const base = await client.bases.create({
      autoMerge: true,
      slug: "field-slug-collide",
      name: "Field Slug Collide",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true },
        { slug: "dup", name: "Dup", type: "text" },
      ],
    });
    const baseId = base.id;
    const oldDupId = base.fields.find((f) => f.slug === "dup")!.id;

    // Delete "dup", then create a NEW active field that reuses the slug.
    await approveAndMerge(
      (await client.bases.deleteFieldChangeRequest({ baseId, fieldId: oldDupId })).id,
    );
    await approveAndMerge(
      (
        await client.bases.createFieldChangeRequest({
          baseId,
          slug: "dup",
          name: "Dup 2",
          type: "number",
          required: false,
        })
      ).id,
    );

    // Restoring the original field must fail at merge (slug now taken).
    const restoreCr = await client.bases.restoreFieldChangeRequest({ baseId, fieldId: oldDupId });
    await expect(approveAndMerge(restoreCr.id)).rejects.toThrow(/slug/i);

    // Exactly one active "dup" field remains.
    const updated = (await client.bases.list()).find((b) => b.id === baseId)!;
    expect(updated.fields.filter((f) => f.slug === "dup")).toHaveLength(1);
  });
});
