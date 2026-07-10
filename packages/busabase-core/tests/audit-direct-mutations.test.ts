import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Every content-tree mutation is recorded as an auto-merged ChangeRequest (so it's
 * in history + rollback, not just an audit line): base / doc / skill create, field
 * add, and doc body update. Destructive maintenance ops with no content-operation
 * semantics (node purge, asset delete) stay audit-only — they satisfy "audit OR CR".
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

  // A merged CR of a given operation whose predicate matches (how a structural
  // mutation is now recorded).
  const hasMergedCR = async (
    operation: string,
    match: (cr: {
      baseId: string | null;
      nodeId: string | null;
      node: { slug: string } | null;
    }) => boolean,
  ) =>
    (await client.changeRequests.list()).some(
      (cr) => cr.status === "merged" && cr.primaryOperation?.operation === operation && match(cr),
    );

  it("records merged ChangeRequests for a base create + field add", async () => {
    const base = await client.bases.create({
      slug: "audit-base",
      name: "Audit Base",
      fields: [{ slug: "title", name: "Title", type: "text", required: true }],
      autoMerge: true,
    });
    if ("status" in base) throw new Error("Expected materialized BaseVO");
    await client.bases.createField({
      baseId: base.id,
      slug: "extra",
      name: "Extra",
      type: "text",
    });
    expect(await hasMergedCR("node_create", (cr) => cr.node?.slug === "audit-base")).toBe(true);
    expect(await hasMergedCR("base_add_field", (cr) => cr.baseId === base.id)).toBe(true);
  });

  it("records merged ChangeRequests for a doc create + body update", async () => {
    const doc = await client.docs.create({
      slug: "audit-doc",
      name: "Audit Doc",
      body: "v1",
      autoMerge: true,
    });
    if ("status" in doc) throw new Error("Expected materialized DocVO");
    await client.docs.updateBody({ nodeId: doc.node.id, body: "v2" });
    expect(await hasMergedCR("node_create", (cr) => cr.node?.slug === "audit-doc")).toBe(true);
    expect(await hasMergedCR("doc_update", (cr) => cr.nodeId === doc.node.id)).toBe(true);
  });

  it("records a merged ChangeRequest for a skill create", async () => {
    await client.skills.create({ slug: "audit-skill", name: "Audit Skill", autoMerge: true });
    expect(await hasMergedCR("node_create", (cr) => cr.node?.slug === "audit-skill")).toBe(true);
  });

  it("audits permanent node purge", async () => {
    const folderBySlug = async (slug: string) =>
      (await client.folders.list()).find((f) => f.node.slug === slug);

    // Explicit auto-merge keeps this audit setup compact.
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "create", nodeType: "folder", slug: "audit-purge", name: "Purge" }],
    });
    const folder = await folderBySlug("audit-purge");
    if (!folder) {
      throw new Error("Expected audit-purge folder to exist");
    }
    const folderId = folder.node.id;
    // Archive it (delete), then permanently purge.
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "delete", nodeId: folderId }],
    });
    await client.nodes.purge({ nodeId: folderId });

    const events = await client.auditEvents.list({ limit: 100 });
    const purge = events.find((e) => e.action === "node.purged");
    expect(purge).toBeDefined();
    expect((purge?.metadata as { nodeId?: string })?.nodeId).toBe(folderId);
  });
});
