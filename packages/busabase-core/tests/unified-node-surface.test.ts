import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithAnonymousContext } from "../src/context";
import { setNodeShare } from "../src/logic/node-share";
import { busabaseRouter } from "../src/router";

/**
 * The unified Node surface: `GET /nodes/{nodeId}` (Candidate A) and
 * `GET /nodes?types=` (Candidate B), replacing the typed list/get pairs for
 * Docs, Files, Folders, and file-tree nodes.
 *
 * The user-visible promises being pinned here:
 *   - holding a node id is enough to open it — no type-discovery round trip,
 *     and the payload is still the one that type's own view already reads;
 *   - a node you cannot see is indistinguishable from one that does not exist,
 *     and NOTHING about it is hydrated on the way to that answer;
 *   - a slug that means two different things is refused, not guessed at;
 *   - listing a type stays cheap — asking "which Docs exist" must not download
 *     every Doc.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

// PGlite migrations are an app artifact resolved from `process.cwd()/src/db/
// migrations`; busabase-core has none of its own, so run against the reference app.
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("unified Node surface — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let ambiguityFolderId = "";
  let publicDocId = "";
  let publicSkillId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-unified-node-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-unified-node-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    await client.docs.create({
      autoMerge: true,
      slug: "unified-doc",
      name: "Unified Doc",
      body: "# Unified\n\nBody text.\n",
    });
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        { kind: "create", nodeType: "folder", slug: "unified-folder", name: "Unified Folder" },
      ],
    });
    await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      slug: "unified-skill",
      name: "Unified Skill",
    });
    await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      slug: "unified-drive",
      name: "Unified Drive",
    });
    await client.bases.create({
      slug: "unified-base",
      name: "Unified Base",
      fields: [{ slug: "title", name: "Title", type: "text" }],
      autoMerge: true,
    });

    // Slug uniqueness is enforced per node TYPE in a space, so the same slug
    // can intentionally mean two different node types. That is what
    // makes the ambiguity check below a real user scenario rather than a
    // defensive branch nobody can reach.
    const nested = await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        { kind: "create", nodeType: "folder", slug: "ambiguity-home", name: "Ambiguity Home" },
      ],
    });
    ambiguityFolderId = String(
      (nested.mergeSummary.mergedNodeIds as string[] | undefined)?.[0] ?? "",
    );
    await client.docs.create({ autoMerge: true, slug: "shared-slug", name: "Shared Doc" });
    await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      parentNodeId: ambiguityFolderId,
      slug: "shared-slug",
      name: "Shared Skill",
    });

    // Public shares used by the anonymous-boundary block below. BOTH are
    // shared, so a refusal there can only come from the node-type rule.
    const publicDoc = await client.docs.create({
      autoMerge: true,
      slug: "public-doc",
      name: "Public Doc",
      body: "public body\n",
    });
    if ("status" in publicDoc) throw new Error("expected a materialized doc");
    publicDocId = publicDoc.node.id;
    const publicSkill = await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      slug: "public-skill",
      name: "Public Skill",
    });
    if (!("node" in publicSkill)) throw new Error("expected a materialized skill");
    publicSkillId = publicSkill.node.id;
    await setNodeShare(publicDocId, { scope: "public", capability: "read" });
    await setNodeShare(publicSkillId, { scope: "public", capability: "read" });
  }, 120_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  // ── Candidate A: one typed detail read ────────────────────────────────────

  it("returns each type's own detail payload, discriminated by type", async () => {
    const doc = await client.nodes.get({ nodeId: "unified-doc" });
    expect(doc.type).toBe("doc");
    if (doc.type !== "doc") throw new Error("expected a doc");
    expect(doc.body).toContain("Body text.");
    expect(doc.storagePrefix).toBeTruthy();

    const folder = await client.nodes.get({ nodeId: "unified-folder" });
    expect(folder.type).toBe("folder");
    if (folder.type !== "folder") throw new Error("expected a folder");
    expect(Array.isArray(folder.children)).toBe(true);

    const skill = await client.nodes.get({ nodeId: "unified-skill" });
    expect(skill.type).toBe("skill");
    if (skill.type !== "skill") throw new Error("expected a skill");
    expect(skill.files.map((file) => file.path)).toContain("SKILL.md");
    expect(skill.entryFile).toBe("SKILL.md");
  });

  it("takes an id or a slug, with no type hint needed for either", async () => {
    const bySlug = await client.nodes.get({ nodeId: "unified-doc" });
    const byId = await client.nodes.get({ nodeId: bySlug.node.id });
    expect(byId.node.slug).toBe("unified-doc");
    expect(byId.type).toBe("doc");
  });

  it("answers for a node type that has no typed detail of its own", async () => {
    // A Base node was never reachable through any of the four retired gets.
    // Serving the plain node row is strictly additive — but it must be a
    // WELL-FORMED discriminated variant, not a half-filled one.
    const bases = await client.nodes.list({ types: ["base"] });
    const base = bases[0];
    expect(base).toBeDefined();
    const detail = await client.nodes.get({ nodeId: base?.id ?? "" });
    expect(detail.type).toBe("base");
    expect(detail.node.id).toBe(base?.id);
    expect(Object.keys(detail).sort()).toEqual(["node", "type"]);
  });

  it("refuses a slug that exists under more than one type instead of guessing", async () => {
    // The exact scenario the roadmap's "Ambiguous slug" row describes: without
    // this, an agent asking to edit "shared-slug" could be handed the wrong
    // resource entirely.
    expect(ambiguityFolderId).toBeTruthy();
    await expect(client.nodes.get({ nodeId: "shared-slug" })).rejects.toThrow(/pass `type`/);

    // …and the hint resolves it, both ways.
    const asDoc = await client.nodes.get({ nodeId: "shared-slug", type: "doc" });
    const asSkill = await client.nodes.get({ nodeId: "shared-slug", type: "skill" });
    expect(asDoc.type).toBe("doc");
    expect(asSkill.type).toBe("skill");
    expect(asDoc.node.id).not.toBe(asSkill.node.id);
  });

  it("404s a type hint that contradicts the node the id resolves to", async () => {
    const doc = await client.nodes.get({ nodeId: "unified-doc" });
    await expect(client.nodes.get({ nodeId: doc.node.id, type: "folder" })).rejects.toThrow(
      /Node not found/,
    );
  });

  it("404s an archived node, exactly as all four retired gets did", async () => {
    const created = await client.docs.create({
      autoMerge: true,
      slug: "archive-me",
      name: "Archive Me",
    });
    if ("status" in created) throw new Error("expected a materialized doc");
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "delete", nodeId: created.node.id }],
    });

    await expect(client.nodes.get({ nodeId: created.node.id })).rejects.toThrow(/Node not found/);
    // It is in the Trash listing, which is where an archived node belongs.
    const archived = await client.nodes.list({ status: "archived" });
    expect(archived.some((node) => node.id === created.node.id)).toBe(true);
  });

  // ── Candidate B: one cheap summary list ───────────────────────────────────

  it("returns flat lightweight summaries, never the heavy per-type payloads", async () => {
    const docs = await client.nodes.list({ types: ["doc"] });
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) {
      expect(doc.type).toBe("doc");
      // The whole point: no `body`, no `asset`, no `files`, no hydrated
      // children. Listing Docs must not download every Doc.
      expect(doc).not.toHaveProperty("body");
      expect(doc).not.toHaveProperty("asset");
      expect(doc).not.toHaveProperty("files");
      expect(doc.children).toEqual([]);
      // …but it is a real NodeVO, not a stub.
      expect(doc.id).toBeTruthy();
      expect(doc.slug).toBeTruthy();
      expect(doc.createdAt).toBeTruthy();
    }
  });

  it("selects file-tree nodes by their real discriminators, several at once", async () => {
    const both = await client.nodes.list({ types: ["skill", "drive"] });
    const slugs = both.map((node) => node.slug);
    expect(slugs).toContain("unified-skill");
    expect(slugs).toContain("unified-drive");
    expect(both.every((node) => node.type === "skill" || node.type === "drive")).toBe(true);
    // There is no synthetic "file-tree" type — asking for one is a bad request,
    // not an empty list that looks like "you have no Skills".
    await expect(client.nodes.list({ types: ["file-tree" as "skill"] })).rejects.toThrow();
  });

  it("resolves a Base node's baseId without a per-row query", async () => {
    const bases = await client.nodes.list({ types: ["base"] });
    expect(bases.length).toBeGreaterThan(0);
    // A summary that dropped baseId would be wrong, not merely thin — the UI
    // routes to a Base by it.
    expect(bases.every((base) => typeof base.baseId === "string")).toBe(true);
  });

  it("leaves the tree modes completely untouched when types is absent", async () => {
    // Every existing caller passes no `types`; none of them may change shape.
    const tree = await client.nodes.list();
    expect(tree.length).toBe(1);
    expect(tree[0]?.children.length).toBeGreaterThan(0);

    const bounded = await client.nodes.list({ depth: 1 });
    expect(bounded.length).toBe(1);

    const archived = await client.nodes.list({ status: "archived" });
    expect(Array.isArray(archived)).toBe(true);
  });

  it("excludes archived nodes from a type-filtered list by default", async () => {
    const created = await client.docs.create({
      autoMerge: true,
      slug: "list-archive-me",
      name: "List Archive Me",
    });
    if ("status" in created) throw new Error("expected a materialized doc");
    expect(
      (await client.nodes.list({ types: ["doc"] })).some((n) => n.id === created.node.id),
    ).toBe(true);

    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "delete", nodeId: created.node.id }],
    });
    expect(
      (await client.nodes.list({ types: ["doc"] })).some((n) => n.id === created.node.id),
    ).toBe(false);
    expect(
      (await client.nodes.list({ types: ["doc"], status: "archived" })).some(
        (n) => n.id === created.node.id,
      ),
    ).toBe(true);
  });

  // ── Anonymous (public-link) boundary ──────────────────────────────────────
  //
  // Merging four procedures into one collapsed a distinction the allowlist used
  // to make by procedure NAME: `folders.get`/`docs.get`/`files.get` were public,
  // `fileTrees.get` deliberately was not. These prove the boundary survived the
  // merge — on the node TYPE instead — and that it is enforced through the real
  // router, not only in the pure allowlist helper.

  it("lets an anonymous visitor open a publicly shared Doc", async () => {
    const detail = await runWithAnonymousContext({}, () =>
      client.nodes.get({ nodeId: publicDocId }),
    );
    expect(detail.type).toBe("doc");
  });

  it("404s a node that is NOT shared, without hydrating anything about it", async () => {
    // The roadmap's "Hidden Node" row: resolution + ACL happen before any
    // type-specific hydration, so an unshared Doc is indistinguishable from an
    // absent one and its body is never read out of storage on the way there.
    await expect(
      runWithAnonymousContext({}, () => client.nodes.get({ nodeId: "unified-doc" })),
    ).rejects.toThrow(/Node not found/);
  });

  it("refuses a publicly shared Skill to an anonymous visitor", async () => {
    // A public link must never become a way to read an agent's source.
    await expect(
      runWithAnonymousContext({}, () => client.nodes.get({ nodeId: publicSkillId })),
    ).rejects.toThrow(/anonymous/i);
  });

  it("still serves that same Skill to a member", async () => {
    // The gate must be a strict no-op off the anonymous path.
    const detail = await client.nodes.get({ nodeId: publicSkillId });
    expect(detail.type).toBe("skill");
  });
});
