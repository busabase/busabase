import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Integration coverage for the Doc and Folder domains through the real oRPC router
 * (`createRouterClient(busabaseRouter)`), matching the skills/assets test style.
 * These two domains were only exercised indirectly via node-lifecycle tests; here
 * their own procedures — including the approval-first doc-edit change request — run
 * end to end against PGlite + local storage.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

// PGlite migrations are an app artifact resolved from `process.cwd()/src/db/
// migrations`; busabase-core has none of its own, so run against the reference app.
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("Doc & Folder domains — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-docfolder-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-docfolder-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates a doc with a seeded body and lists it", async () => {
    const doc = await client.docs.create({
      autoMerge: true,
      slug: "runbook",
      name: "Runbook",
      body: "# Runbook\n\nStep one.\n",
    });
    expect(doc.node.type).toBe("doc");
    expect(doc.node.slug).toBe("runbook");
    expect(doc.body).toContain("Step one.");

    const docs = await client.docs.list();
    expect(docs.some((d) => d.node.slug === "runbook")).toBe(true);
  });

  it("is idempotent on slug — a second create returns the existing doc", async () => {
    const first = await client.docs.create({
      autoMerge: true,
      slug: "policy",
      name: "Policy",
      body: "v1\n",
    });
    const again = await client.docs.create({
      autoMerge: true,
      slug: "policy",
      name: "Policy (dupe)",
      body: "v2\n",
    });
    expect(again.node.id).toBe(first.node.id);
    // Body is not overwritten by the idempotent re-create.
    expect(again.body).toBe("v1\n");
  });

  it("gets a doc by slug and rejects an unknown one", async () => {
    await client.docs.create({ autoMerge: true, slug: "faq", name: "FAQ", body: "Q&A\n" });
    const doc = await client.docs.get({ nodeId: "faq" });
    expect(doc.body).toContain("Q&A");
    await expect(client.docs.get({ nodeId: "does-not-exist" })).rejects.toThrow();
  });

  it("runs the approval-first doc edit: change request → review → merge writes the body", async () => {
    await client.docs.create({ autoMerge: true, slug: "guide", name: "Guide", body: "draft\n" });

    const cr = await client.docs.createChangeRequest({
      nodeId: "guide",
      body: "# Guide\n\nApproved content.\n",
      message: "Publish the guide",
      submittedBy: "vitest-agent",
    });
    expect(cr.status).toBe("in_review");

    // Body is unchanged until the change request merges.
    expect((await client.docs.get({ nodeId: "guide" })).body).toBe("draft\n");

    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });

    expect((await client.docs.get({ nodeId: "guide" })).body).toContain("Approved content.");
  });

  it("lists folders and resolves a folder's children, rejecting an unknown folder", async () => {
    // A doc with no explicit parent attaches to the space root folder, so at least
    // one folder always exists and the doc shows up among its children.
    await client.docs.create({
      autoMerge: true,
      slug: "nested-note",
      name: "Nested Note",
      body: "hi\n",
    });

    const folders = await client.folders.list();
    expect(folders.length).toBeGreaterThan(0);
    const rootId = folders[0]?.node.id as string;

    const root = await client.folders.get({ nodeId: rootId });
    expect(root.node.id).toBe(rootId);
    expect(root.children.some((child) => child.slug === "nested-note")).toBe(true);

    await expect(client.folders.get({ nodeId: "no-such-folder" })).rejects.toThrow();
  });
});
