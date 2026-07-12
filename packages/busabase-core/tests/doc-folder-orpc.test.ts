import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";
import { busabaseDemoRouter } from "../src/router-demo";

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

  // The Doc-domain equivalent of `assets.readTextLines` (see
  // `tests/drive-grep-retrieval.test.ts`'s `readLines` describe block, which
  // this mirrors) — an agent's follow-up after a Unified Grep match lands
  // inside a Doc, so it can read just the lines around the match instead of
  // `docs.get`'s entire body.
  describe("readLines", () => {
    it("returns the exact requested line range, clamped and reported honestly", async () => {
      const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
      await client.docs.create({
        autoMerge: true,
        slug: "read-lines-mid",
        name: "Read Lines Mid",
        body: lines.join("\n"),
      });

      const result = await client.docs.readLines({
        nodeId: "read-lines-mid",
        startLine: 10,
        endLine: 15,
      });
      expect(result.lines).toEqual([
        "line 10",
        "line 11",
        "line 12",
        "line 13",
        "line 14",
        "line 15",
      ]);
      expect(result.startLine).toBe(10);
      expect(result.endLine).toBe(15);
      expect(result.totalLines).toBe(30);
      expect(result.truncated).toBe(false);
    });

    it("clamps a range that runs past EOF", async () => {
      await client.docs.create({
        autoMerge: true,
        slug: "read-lines-short",
        name: "Read Lines Short",
        body: "a\nb\nc",
      });

      const result = await client.docs.readLines({
        nodeId: "read-lines-short",
        startLine: 1,
        endLine: 10,
      });
      expect(result.lines).toEqual(["a", "b", "c"]);
      expect(result.totalLines).toBe(3);
    });

    it("reports truncated: false when the requested range reaches exactly EOF", async () => {
      const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`);
      await client.docs.create({
        autoMerge: true,
        slug: "read-lines-exact-eof",
        name: "Read Lines Exact EOF",
        body: lines.join("\n"),
      });

      const result = await client.docs.readLines({
        nodeId: "read-lines-exact-eof",
        startLine: 1,
        endLine: 12,
      });
      expect(result.lines).toHaveLength(12);
      expect(result.totalLines).toBe(12);
      expect(result.truncated).toBe(false);
    });

    it("caps a request exceeding the 2000-line cap, reporting truncated: true", async () => {
      const lines = Array.from({ length: 3000 }, (_, i) => `l${i}`);
      await client.docs.create({
        autoMerge: true,
        slug: "read-lines-cap",
        name: "Read Lines Cap",
        body: lines.join("\n"),
      });

      const result = await client.docs.readLines({
        nodeId: "read-lines-cap",
        startLine: 1,
        endLine: 3000,
      });
      expect(result.lines.length).toBeLessThanOrEqual(2000);
      // Unlike `assets.readTextLines` (whose `truncated` only reflects a
      // byte-cap-driven early stop for the already-capped window — see
      // `sliceDocLinesRange`'s doc comment), Docs' `readLines` also flags
      // `truncated: true` when the 2000-line cap itself reduced the window,
      // so a caller always knows it got less than it asked for.
      expect(result.truncated).toBe(true);
    });

    it("grep → readLines loop: the reported match line matches the read-back content", async () => {
      const lines = Array.from({ length: 30 }, (_, i) =>
        i === 20 ? "NEEDLE-HERE" : `filler ${i}`,
      );
      const doc = await client.docs.create({
        autoMerge: true,
        slug: "read-lines-loop",
        name: "Read Lines Loop",
        body: lines.join("\n"),
      });
      if (!("node" in doc)) throw new Error("Expected a materialized DocVO (autoMerge: true)");

      const grep = await client.grep({
        pattern: "NEEDLE-HERE",
        sources: ["docs"],
        scope: { docs: { nodeIds: [doc.node.id] } },
      });
      const match = grep.matches[0];
      expect(match).toBeDefined();
      if (!match || match.source !== "docs") throw new Error("Expected a docs match");

      const read = await client.docs.readLines({
        nodeId: doc.node.id,
        startLine: match.line,
        endLine: match.line,
      });
      expect(read.lines[0]).toBe("NEEDLE-HERE");
    });

    it("rejects a non-existent nodeId with NOT_FOUND", async () => {
      await expect(
        client.docs.readLines({ nodeId: "read-lines-does-not-exist", startLine: 1, endLine: 5 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});

// `readLines` is a pure read backed entirely by the seed dataset's in-memory
// `DemoDocVO.body` (same as `docs.get` already relies on in demo mode) — no
// real storage needed, unlike `assets.readTextLines`/`assets.grep`, which stay
// `demoUnsupported` for lack of per-asset object storage in the stateless demo
// dataset (see `router-demo.ts`). No existing test file exercises
// `busabaseDemoRouter` yet, so this is a self-contained, DB/storage-free
// integration check (the demo router never touches the db).
describe("Doc domain — readLines (demo mode)", () => {
  const demoClient = createRouterClient(busabaseDemoRouter);

  it("reads a range from the seeded demo Doc's in-memory body", async () => {
    const result = await demoClient.docs.readLines({
      nodeId: "agent-operating-guide",
      startLine: 1,
      endLine: 2,
    });
    expect(result.lines[0]).toBe("# Agent Operating Guide");
    expect(result.totalLines).toBeGreaterThan(2);
    expect(result.truncated).toBe(false);
  });

  it("rejects a non-existent nodeId with NOT_FOUND", async () => {
    await expect(
      demoClient.docs.readLines({ nodeId: "does-not-exist", startLine: 1, endLine: 5 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
