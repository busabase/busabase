import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Public-API calls that used to "succeed" while doing nothing (or something
 * other than asked) — each one an agent could not tell apart from a real
 * answer. Every case runs through the real router against PGlite.
 *
 *  1. records.list / search / count with a Base SLUG → empty list / 0
 *  2. record writes keyed by display name → value silently dropped
 *  3. nodes.list parentId slug / unknown / non-folder → []; `types` ignored parentId
 *  4. docs.create on a taken slug in the same folder → the old doc, marked created
 *  5. file-tree `update` of a missing path → silently created
 *  6. id-only params where neighbours take slugs
 *  7. playbooks.search `query` (unknown key) → browse everything
 *  8. nodes.readLines on a file tree → "Node not found"
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const payloadOf = (record: unknown) =>
  (record as { headCommit: { payload: Record<string, unknown> } }).headCommit.payload;

describe("public API silent failures", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let fieldIds: Record<string, string> = {};
  let folderId = "";
  let docId = "";
  let skillInsideId = "";
  let skillOutsideId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-silent-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-silent-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "leads",
      name: "Leads",
      fields: [
        { slug: "name", name: "Name", type: "text", required: false, options: {} },
        {
          slug: "status",
          name: { en: "Status", "zh-CN": "状态" },
          type: "text",
          required: false,
          options: {},
        },
        { slug: "notes", name: "Notes", type: "text", required: false, options: {} },
      ],
      autoMerge: true,
    } as never);
    if (!("id" in base)) throw new Error("expected a materialized Base");
    baseId = base.id;
    fieldIds = Object.fromEntries(base.fields.map((field) => [field.slug, field.id]));
    await client.bases.createChangeRequest({ baseId, fields: { name: "Seed" }, autoMerge: true });

    const folderCr = await client.nodes.createChangeRequest({
      operations: [{ kind: "create", nodeType: "folder", slug: "projects", name: "Projects" }],
      autoMerge: true,
    } as never);
    const tree = await client.nodes.list({ types: ["folder"] });
    folderId = tree.find((node) => node.slug === "projects")?.id ?? "";
    expect(folderCr.status).toBe("merged");
    expect(folderId).toBeTruthy();

    const doc = await client.docs.create({
      slug: "plan",
      name: "Plan",
      body: "original\n",
      parentNodeId: folderId,
      autoMerge: true,
    });
    if (!("node" in doc)) throw new Error("expected a materialized Doc");
    docId = doc.node.id;

    const inside = await client.fileTrees.create({
      type: "skill",
      slug: "inside-skill",
      name: "Inside Skill",
      parentNodeId: folderId,
      autoMerge: true,
    } as never);
    const outside = await client.fileTrees.create({
      type: "skill",
      slug: "outside-skill",
      name: "Outside Skill",
      autoMerge: true,
    } as never);
    if (!("node" in inside) || !("node" in outside)) throw new Error("expected skills");
    skillInsideId = inside.node.id;
    skillOutsideId = outside.node.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  describe("1. record listings accept a Base slug and 404 an unknown one", () => {
    it("records.list by slug returns the Base's records", async () => {
      const page = await client.records.list({ baseId: "leads" });
      expect(page.records.map((record) => payloadOf(record).name)).toContain("Seed");
    });

    it("records.list with an unknown Base is a 404, not an empty page", async () => {
      await expect(client.records.list({ baseId: "no-such-base" })).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: expect.stringContaining("no-such-base"),
      });
      await expect(
        client.records.list({ baseId: "no-such-base", status: "archived" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("records.search by slug finds the record; an unknown field is a 400", async () => {
      const hits = await client.records.search({
        baseId: "leads",
        fieldSlug: "name",
        valueText: "Seed",
      });
      expect(hits).toHaveLength(1);
      await expect(
        client.records.search({ baseId: "no-such-base", fieldSlug: "name", valueText: "Seed" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        client.records.search({ baseId: "leads", fieldSlug: "Name", valueText: "Seed" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("status") });
    });

    it("records.count by slug counts; unknown is a 404", async () => {
      const { total } = await client.records.count({ baseId: "leads" });
      expect(total).toBeGreaterThan(0);
      await expect(client.records.count({ baseId: "no-such-base" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("2. record writes resolve display names and reject writes that name no field", () => {
    it("create keyed by display name stores the value under the slug", async () => {
      const created = await client.bases.createChangeRequest({
        baseId,
        fields: { Name: "Display-name write", 状态: "open" },
        autoMerge: true,
      });
      expect(payloadOf(created)).toMatchObject({ name: "Display-name write", status: "open" });
      expect(payloadOf(created)).not.toHaveProperty("Name");
    });

    it("create keyed by field id stores the value under the slug", async () => {
      const created = await client.bases.createChangeRequest({
        baseId,
        fields: { [fieldIds.name as string]: "By id" },
        autoMerge: true,
      });
      expect(payloadOf(created)).toMatchObject({ name: "By id" });
    });

    it("a write in which no key names a field is a 400 listing the slugs", async () => {
      await expect(
        client.bases.createChangeRequest({ baseId, fields: { nmae: "typo" }, autoMerge: true }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(/nmae.*name \(Name\)/),
      });
    });

    it("the same field twice (slug and name) is a 400", async () => {
      await expect(
        client.bases.createChangeRequest({
          baseId,
          fields: { name: "a", Name: "b" },
          autoMerge: true,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("twice") });
    });

    it("extra keys next to a real field are still tolerated (round-tripped payloads)", async () => {
      const created = await client.bases.createChangeRequest({
        baseId,
        fields: { name: "With extra", someClientKey: 1 },
        autoMerge: true,
      });
      expect(payloadOf(created)).toMatchObject({ name: "With extra" });
    });

    it("single update, bulk create and bulk update resolve names too", async () => {
      const created = await client.bases.createChangeRequest({
        baseId,
        fields: { name: "To update" },
        autoMerge: true,
      });
      const recordId = (created as { id: string }).id;
      const updated = await client.records.changeRequest({
        operation: "update",
        recordId,
        fields: { Status: "won" },
        autoMerge: true,
      } as never);
      expect(payloadOf(updated)).toMatchObject({ name: "To update", status: "won" });
      await expect(
        client.records.changeRequest({
          operation: "update",
          recordId,
          fields: { Stauts: "lost" },
          autoMerge: true,
        } as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      const bulk = await client.bases.createBulkChangeRequest({
        baseId,
        records: [{ Name: "Bulk A" }, { name: "Bulk B" }],
        autoMerge: true,
      } as never);
      expect(bulk.status).toBe("merged");
      const hits = await client.records.search({ baseId, fieldSlug: "name", valueText: "Bulk A" });
      expect(hits).toHaveLength(1);
      await expect(
        client.bases.createBulkChangeRequest({
          baseId,
          records: [{ name: "ok" }, { nope: "x" }],
          autoMerge: true,
        } as never),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("records[1]"),
      });

      const bulkUpdate = await client.bases.createBulkUpdateChangeRequest({
        baseId,
        updates: [{ recordId, fields: { Notes: "bulk-noted" } }],
        autoMerge: true,
      } as never);
      expect(bulkUpdate.status).toBe("merged");
      const reread = await client.records.get({ recordId });
      expect(payloadOf(reread)).toMatchObject({ notes: "bulk-noted" });
    });

    it("an echoed payload carrying a deleted field's key still updates", async () => {
      const created = await client.bases.createChangeRequest({
        baseId,
        fields: { name: "Echo", notes: "kept in history" },
        autoMerge: true,
      });
      const recordId = (created as { id: string }).id;
      await client.bases.fieldChangeRequest({
        operation: "delete",
        baseId,
        fieldId: fieldIds.notes as string,
        autoMerge: true,
      } as never);
      const record = await client.records.get({ recordId });
      // What the dashboard's board/calendar moves send: the stored payload + a patch.
      const echoed = { ...payloadOf(record), status: "moved" };
      expect(echoed).toHaveProperty("notes");
      const updated = await client.records.changeRequest({
        operation: "update",
        recordId,
        fields: echoed,
        autoMerge: true,
      } as never);
      expect(payloadOf(updated)).toMatchObject({ status: "moved" });
    });
  });

  describe("3. nodes.list parentId", () => {
    it("accepts a folder slug", async () => {
      const children = await client.nodes.list({ parentId: "projects", depth: 1 });
      expect(children.map((node) => node.id)).toEqual(
        expect.arrayContaining([docId, skillInsideId]),
      );
    });

    it("an unknown parent is a 404 and a non-folder a 400", async () => {
      await expect(
        client.nodes.list({ parentId: "no-such-folder", depth: 1 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(client.nodes.list({ parentId: docId, depth: 1 })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("not a folder"),
      });
    });

    it("types + parentId filters within the folder's subtree", async () => {
      const skills = await client.nodes.list({ parentId: folderId, types: ["skill"] });
      const ids = skills.map((node) => node.id);
      expect(ids).toContain(skillInsideId);
      expect(ids).not.toContain(skillOutsideId);
      const everywhere = await client.nodes.list({ types: ["skill"] });
      expect(everywhere.map((node) => node.id)).toContain(skillOutsideId);
    });

    it("parentId with status=archived is a 400", async () => {
      await expect(
        client.nodes.list({ parentId: folderId, status: "archived" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("4. docs.create on a taken slug in the same folder", () => {
    it("a true retry (same name and body) returns the existing doc", async () => {
      const again = await client.docs.create({
        slug: "plan",
        name: "Plan",
        body: "original\n",
        parentNodeId: folderId,
        autoMerge: true,
      });
      expect("node" in again && again.node.id).toBe(docId);
    });

    it("a different name or body is a 409 naming the existing doc", async () => {
      await expect(
        client.docs.create({
          slug: "plan",
          name: "Plan",
          body: "new body\n",
          parentNodeId: folderId,
          autoMerge: true,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining(docId) });
      await expect(
        client.docs.create({
          slug: "plan",
          name: "Other",
          body: "original\n",
          parentNodeId: folderId,
          autoMerge: true,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const doc = await client.nodes.get({ nodeId: docId });
      expect((doc as { body: string }).body).toBe("original\n");
    });
  });

  describe("5. file-tree update of a missing path", () => {
    it("is a 404 that says to use create", async () => {
      await expect(
        client.fileTrees.createChangeRequest({
          nodeId: skillInsideId,
          operations: [{ kind: "update", path: "ghost.md", content: "boo" }],
          autoMerge: true,
        } as never),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: expect.stringContaining("create") });
      const files = await client.fileTrees.listFiles({ nodeId: skillInsideId } as never);
      expect((files as Array<{ path: string }>).map((file) => file.path)).not.toContain("ghost.md");
    });

    it("update of an existing path and create-then-update in one batch still work", async () => {
      const edited = await client.fileTrees.createChangeRequest({
        nodeId: skillInsideId,
        operations: [
          { kind: "update", path: "SKILL.md", content: "---\nname: inside-skill\n---\n# v2\n" },
          { kind: "create", path: "notes.md", content: "one" },
          { kind: "update", path: "notes.md", content: "two" },
        ],
        autoMerge: true,
      } as never);
      expect(edited.status).toBe("merged");
    });
  });

  describe("6. slugs where neighbours accept them", () => {
    it("nodes.updateContent takes a doc slug", async () => {
      const changeRequest = await client.nodes.updateContent({
        nodeId: "plan",
        content: { kind: "doc", body: "edited by slug\n" },
        autoMerge: true,
      });
      expect(changeRequest.status).toBe("merged");
      const doc = await client.nodes.get({ nodeId: docId });
      expect((doc as { body: string }).body).toBe("edited by slug\n");
      // A wrong kind still names the mismatch.
      await expect(
        client.nodes.updateContent({
          nodeId: docId,
          content: { kind: "html", document: { version: 1, source: "<p/>" } },
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("does not match"),
      });
    });

    it("playbooks.get takes a skill slug", async () => {
      const playbook = await client.playbooks.get({ kind: "skill", nodeId: "inside-skill" });
      expect(playbook.nodeId).toBe(skillInsideId);
      await expect(client.playbooks.get({ kind: "skill", nodeId: "plan" })).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: expect.stringContaining("not a skill"),
      });
    });

    it("docs.create parentNodeId takes a folder slug; a non-folder is a 422", async () => {
      const doc = await client.docs.create({
        slug: "by-folder-slug",
        name: "By folder slug",
        parentNodeId: "projects",
        autoMerge: true,
      });
      expect("node" in doc && doc.node.parentId).toBe(folderId);
      await expect(
        client.docs.create({ slug: "under-doc", name: "x", parentNodeId: "plan", autoMerge: true }),
      ).rejects.toMatchObject({ code: "INVALID_PARENT_NODE_TYPE" });
      await expect(
        client.docs.create({
          slug: "under-nothing",
          name: "x",
          parentNodeId: "nope",
          autoMerge: true,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("7. playbooks.search rejects unknown keys", () => {
    it("`query` instead of `queries` is a 400 naming both", async () => {
      const error = await client.playbooks
        .search({ query: "zzz" } as never)
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: "BAD_REQUEST" });
      const issues = (error as { data?: { issues?: Array<{ message: string }> } }).data?.issues;
      expect(issues?.[0]?.message).toMatch(/"query".*queries/);
    });

    it("valid input still searches", async () => {
      const result = await client.playbooks.search({ queries: ["inside skill"] });
      expect(result.items.map((item) => item.nodeId)).toContain(skillInsideId);
    });
  });

  describe("8. nodes.readLines on a node with no lines", () => {
    it("a skill is a 400 pointing at the file-tree endpoints", async () => {
      await expect(
        client.nodes.readLines({ nodeId: skillInsideId, startLine: 1, endLine: 5 }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("/file-trees/"),
      });
    });

    it("a doc by slug still reads; an unknown node is still a 404", async () => {
      const lines = await client.nodes.readLines({ nodeId: "plan", startLine: 1, endLine: 5 });
      expect(lines.totalLines).toBeGreaterThan(0);
      await expect(
        client.nodes.readLines({ nodeId: "no-such-node", startLine: 1, endLine: 5 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
