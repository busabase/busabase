import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Direct (non-change-request) mutations must still leave an audit-log entry, so the
 * product stays fully auditable even for operations that bypass propose → review → merge.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("audit trail for direct mutations", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-audit-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-audit-storage-"));
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

  const auditActions = async () =>
    (await client.auditEvents.list({ limit: 100 })).map((e) => e.action);

  it("audits base + field direct creation", async () => {
    const base = await client.bases.create({
      slug: "audit-base",
      name: "Audit Base",
      fields: [{ slug: "title", name: "Title", type: "text", required: true }],
    });
    await client.bases.createField({
      baseId: base.id,
      slug: "extra",
      name: "Extra",
      type: "text",
    });
    const actions = await auditActions();
    expect(actions).toContain("base.created");
    expect(actions).toContain("field.created");
  });

  it("audits doc create + direct body update", async () => {
    const doc = await client.docs.create({ slug: "audit-doc", name: "Audit Doc", body: "v1" });
    await client.docs.updateBody({ nodeId: doc.node.id, body: "v2" });
    const actions = await auditActions();
    expect(actions).toContain("doc.created");
    expect(actions).toContain("doc.updated");
  });

  it("audits skill direct creation", async () => {
    await client.skills.create({ slug: "audit-skill", name: "Audit Skill" });
    expect(await auditActions()).toContain("skill.created");
  });

  it("audits permanent node purge", async () => {
    const folderBySlug = async (slug: string) =>
      (await client.folders.list()).find((f) => f.node.slug === slug);

    await approveAndMerge(
      (
        await client.nodes.createChangeRequest({
          operations: [{ kind: "create", nodeType: "folder", slug: "audit-purge", name: "Purge" }],
        })
      ).id,
    );
    const folderId = (await folderBySlug("audit-purge"))!.node.id;
    // Archive it (delete), then permanently purge.
    await approveAndMerge(
      (
        await client.nodes.createChangeRequest({
          operations: [{ kind: "delete", nodeId: folderId }],
        })
      ).id,
    );
    await client.nodes.purge({ nodeId: folderId });

    const events = await client.auditEvents.list({ limit: 100 });
    const purge = events.find((e) => e.action === "node.purged");
    expect(purge).toBeDefined();
    expect((purge?.metadata as { nodeId?: string })?.nodeId).toBe(folderId);
  });
});
