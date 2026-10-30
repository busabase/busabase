import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import {
  AGENT_CONTEXT_MAX_BYTES,
  resolveAgentContextResources,
} from "../src/domains/agents/logic/agent-context-resources";
import { docBodyKey } from "../src/domains/doc/handlers";
import { busabaseRouter } from "../src/router";

const owner = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext(
    {
      spaceId: LOCAL_SPACE_ID,
      actorId: "context-owner",
      isSpaceManager: true,
    },
    fn,
  );
const reader = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext(
    {
      spaceId: LOCAL_SPACE_ID,
      actorId: "context-reader",
      isSpaceManager: false,
      permissionLevel: "write",
      restrictedVisibility: false,
    },
    fn,
  );

describe("Agent page snapshots — real isolated DB and object storage", () => {
  let dbDir = "";
  let storageDir = "";
  let originalCwd = "";
  const oldDbUrl = process.env.PG_DATABASE_URL;
  const oldStorageUrl = process.env.STORAGE_URL;
  const client = createRouterClient(busabaseRouter);

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dbDir = await mkdtemp(path.join(os.tmpdir(), "busabase-agent-context-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-agent-context-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dbDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
  });

  afterAll(async () => {
    if (oldDbUrl === undefined) delete process.env.PG_DATABASE_URL;
    else process.env.PG_DATABASE_URL = oldDbUrl;
    if (oldStorageUrl === undefined) delete process.env.STORAGE_URL;
    else process.env.STORAGE_URL = oldStorageUrl;
    process.chdir(originalCwd);
    for (const dir of [dbDir, storageDir]) if (dir) await rm(dir, { recursive: true, force: true });
  });

  const createDoc = async (slug: string, body: string, parentNodeId?: string) => {
    const created = await client.docs.create({
      slug,
      name: slug,
      body,
      parentNodeId,
      autoMerge: true,
    });
    if (!("node" in created)) throw new Error("Expected a materialized document");
    return created.node.id;
  };

  it("sends no context unless referenced, and takes a new immutable snapshot for each send", async () =>
    owner(async () => {
      const nodeId = await createDoc("context-fresh", "ORIGINAL_CONTEXT_MARKER");
      expect(await resolveAgentContextResources(undefined)).toEqual([]);
      const [original] = await resolveAgentContextResources([{ nodeId }, { nodeId }]);
      expect(original?.text).toContain("ORIGINAL_CONTEXT_MARKER");
      expect(original?.text).toContain("Reference material selected by the user");
      expect(original?.uri).toBe(`busabase://spaces/local/nodes/${nodeId}`);
      await client.nodes.updateContent({
        nodeId,
        autoMerge: true,
        content: { kind: "doc", body: "NEW_CONTEXT_MARKER" },
      });
      const [updated] = await resolveAgentContextResources([{ nodeId }]);
      expect(updated?.text).toContain("NEW_CONTEXT_MARKER");
      expect(updated?.text).not.toContain("ORIGINAL_CONTEXT_MARKER");
      expect(original?.text).toContain("ORIGINAL_CONTEXT_MARKER");
      expect((await resolveAgentContextResources([{ nodeId }, { nodeId }])).length).toBe(1);
    }));

  it("caps multibyte text with a visible marker without corrupting UTF-8", async () =>
    owner(async () => {
      const nodeId = await createDoc("context-long", "上下文🐈".repeat(9_000));
      const [snapshot] = await resolveAgentContextResources([{ nodeId }]);
      expect(snapshot?.truncated).toBe(true);
      expect(Buffer.byteLength(snapshot?.text ?? "", "utf8")).toBeLessThanOrEqual(
        AGENT_CONTEXT_MAX_BYTES,
      );
      expect(snapshot?.text).toContain("Context truncated");
      expect(snapshot?.text).not.toContain("�");
      expect(snapshot?.text).toContain(nodeId);
    }));

  it("refuses inaccessible, missing, and cross-space nodes before reading content", async () => {
    const nodeId = await owner(async () => {
      const id = await createDoc("context-private", "PRIVATE_BODY");
      await client.nodes.updateVisibility({ nodeId: id, visibility: "private" });
      return id;
    });
    await reader(async () => {
      await expect(resolveAgentContextResources([{ nodeId }])).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(resolveAgentContextResources([{ nodeId: "nod_missing" }])).rejects.toMatchObject(
        { code: "NOT_FOUND" },
      );
    });
    await runWithBusabaseContext(
      { spaceId: "other-context-space", actorId: "context-owner", isSpaceManager: true },
      async () => {
        await expect(resolveAgentContextResources([{ nodeId }])).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      },
    );
  });

  it("reads only visible direct children, caps the directory, and omits descendants", async () =>
    owner(async () => {
      const folder = await client.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          { kind: "create", nodeType: "folder", slug: "context-folder", name: "Context Folder" },
        ],
      });
      const nodeId = folder.mergeSummary.mergedNodeIds?.[0];
      if (!nodeId) throw new Error("Expected a folder");
      const hidden = await createDoc("context-hidden-child", "SHOULD_NOT_READ_BODY", nodeId);
      await client.nodes.updateVisibility({ nodeId: hidden, visibility: "private" });
      const nested = await client.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          {
            kind: "create",
            nodeType: "folder",
            parentNodeId: nodeId,
            slug: "context-nested",
            name: "Nested",
          },
          ...Array.from({ length: 51 }, (_, index) => ({
            kind: "create" as const,
            nodeType: "folder" as const,
            parentNodeId: nodeId,
            slug: `context-child-${index}`,
            name: `Visible Child ${index}`,
          })),
        ],
      });
      const nestedId = nested.mergeSummary.mergedNodeIds?.[0];
      if (!nestedId) throw new Error("Expected a nested folder");
      await createDoc("context-grandchild", "GRANDCHILD_BODY", nestedId);
      await reader(async () => {
        const [snapshot] = await resolveAgentContextResources([{ nodeId }]);
        expect(snapshot?.truncated).toBe(true);
        expect(snapshot?.text).not.toContain("context-hidden-child");
        expect(snapshot?.text).not.toContain("SHOULD_NOT_READ_BODY");
        expect(snapshot?.text).not.toContain("context-grandchild");
        const body = snapshot?.text
          .split("## Direct children\n")[1]
          ?.split("\n\n[Context truncated")[0];
        expect(JSON.parse(body ?? "[]")).toHaveLength(50);
      });
    }));

  it("includes field definitions and at most 20 whole-Base example records", async () =>
    owner(async () => {
      const base = await client.bases.create({
        slug: "context-sample",
        name: "Sample",
        autoMerge: true,
      });
      if (!base.materialized) throw new Error("Expected a Base");
      await client.bases.createField({
        baseId: base.id,
        name: "Context label",
        slug: "context_label",
        type: "text",
      });
      for (let index = 0; index < 23; index += 1) {
        await client.bases.createChangeRequest({
          baseId: base.id,
          fields: { context_label: `Sample ${index}` },
          autoMerge: true,
        });
      }
      const [snapshot] = await resolveAgentContextResources([{ nodeId: base.nodeId }]);
      expect(snapshot?.text).toContain("Context label");
      expect(snapshot?.text).toContain("whole Base");
      expect(snapshot?.truncated).toBe(true);
      const records = snapshot?.text
        .split("selected rows.\n")[1]
        ?.split("\n\n[Context truncated")[0];
      expect(JSON.parse(records ?? "[]")).toHaveLength(20);
    }));

  it("embeds a Skill's entry file while bounding its directory and omitting other file bodies", async () =>
    owner(async () => {
      const entryMarker = `skill-entry-${randomUUID()}`;
      const omittedMarker = `unread-file-${randomUUID()}`;
      const skill = await client.fileTrees.create({
        type: "skill",
        slug: "context-skill",
        name: "Context Skill",
        autoMerge: true,
        mergeMode: "replace",
        files: [
          { path: "SKILL.md", content: `# Skill reference\n${entryMarker}` },
          ...Array.from({ length: 52 }, (_, index) => ({
            path: `reference-${index.toString().padStart(2, "0")}.md`,
            content: omittedMarker,
          })),
        ],
      });
      if (!("node" in skill)) throw new Error("Expected a materialized Skill");
      const [snapshot] = await resolveAgentContextResources([{ nodeId: skill.node.id }]);
      expect(snapshot?.text).toContain(entryMarker);
      expect(snapshot?.text).toContain("## Entry file: SKILL.md");
      expect(snapshot?.text).not.toContain(omittedMarker);
      expect(snapshot?.text).not.toContain("/api/test/storage");
      expect(snapshot?.truncated).toBe(true);
      const directory = snapshot?.text.split("## Files\n")[1]?.split("\n\n## Entry file:")[0];
      expect(JSON.parse(directory ?? "[]")).toHaveLength(50);
    }));

  it("reads actual HTML, whiteboard, and workflow content through their storage adapters", async () =>
    owner(async () => {
      const marker = `rich-content-${randomUUID()}`;
      const deletedMarker = `deleted-content-${randomUUID()}`;
      const contents = [
        {
          kind: "html" as const,
          document: { version: 1 as const, source: `<article>${marker}-html</article>` },
        },
        {
          kind: "whiteboard" as const,
          document: {
            version: 1 as const,
            elements: [
              { type: "text", originalText: `${marker}-whiteboard`, text: "wrapped text" },
              { type: "text", originalText: deletedMarker, isDeleted: true },
            ],
            appState: {},
          },
        },
        {
          kind: "workflow" as const,
          document: {
            version: 2 as const,
            nodes: [
              {
                id: "context-trigger",
                kind: "trigger" as const,
                position: { x: 0, y: 0 },
                label: `${marker}-workflow`,
                description: "Stored flow",
                eventName: "manual",
              },
            ],
            edges: [],
            settings: {
              executionMode: "manual" as const,
              concurrency: 1,
              timeoutMs: 30_000,
              errorPolicy: "stop" as const,
            },
          },
        },
      ];
      for (const content of contents) {
        const created = await client.nodes.createChangeRequest({
          autoMerge: true,
          operations: [
            {
              kind: "create",
              nodeType: content.kind,
              slug: `context-${content.kind}`,
              name: `Context ${content.kind}`,
            },
          ],
        });
        const nodeId = created.mergeSummary.mergedNodeIds?.[0];
        if (!nodeId) throw new Error("Expected a materialized rich node");
        await client.nodes.updateContent({ nodeId, content, autoMerge: true });
        const [snapshot] = await resolveAgentContextResources([{ nodeId }]);
        expect(snapshot?.text).toContain(`${marker}-${content.kind}`);
        expect(snapshot?.text).not.toContain(deletedMarker);
        expect(snapshot?.text).not.toContain('"position"');
        expect(snapshot?.truncated).toBe(false);
      }
    }));

  it("includes visible Form bindings and field configuration without copying unrelated Base records", async () =>
    owner(async () => {
      const marker = `form-field-${randomUUID()}`;
      const recordMarker = `unrelated-record-${randomUUID()}`;
      const base = await client.bases.create({
        slug: "context-form-base",
        name: "Form target",
        autoMerge: true,
      });
      if (!base.materialized) throw new Error("Expected a materialized Base");
      await client.bases.createField({
        baseId: base.id,
        name: marker,
        slug: "answer",
        type: "text",
      });
      await client.bases.createChangeRequest({
        baseId: base.id,
        fields: { answer: recordMarker },
        autoMerge: true,
      });
      const created = await client.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          {
            kind: "create",
            nodeType: "form",
            slug: "context-form",
            name: "Context Form",
            metadata: {
              targetBaseId: base.id,
              formBindings: [{ inputName: "response", fieldSlug: "answer", required: true }],
            },
          },
        ],
      });
      const nodeId = created.mergeSummary.mergedNodeIds?.[0];
      if (!nodeId) throw new Error("Expected a materialized Form");
      const [snapshot] = await resolveAgentContextResources([{ nodeId }]);
      expect(snapshot?.text).toContain(marker);
      expect(snapshot?.text).toContain('"inputName": "response"');
      expect(snapshot?.text).toContain('"required": true');
      expect(snapshot?.text).not.toContain(recordMarker);
      expect(snapshot?.truncated).toBe(false);
    }));

  it("embeds a textual File's actual bytes and describes a binary File without its bytes or temporary URL", async () =>
    owner(async () => {
      const textMarker = `text-file-${randomUUID()}`;
      const binaryMarker = `binary-file-${randomUUID()}`;
      const cases = [
        {
          slug: "context-text-file",
          fileName: "context-note.md",
          mimeType: "text/markdown",
          data: Buffer.from(`# Note\n${textMarker}`),
        },
        {
          slug: "context-binary-file",
          fileName: "context-report.pdf",
          mimeType: "application/pdf",
          data: Buffer.from(`%PDF-1.7\n${binaryMarker}\n\u0000\u0001`),
        },
      ];
      for (const fixture of cases) {
        const uploadInput = {
          fileName: fixture.fileName,
          mimeType: fixture.mimeType,
          sizeBytes: fixture.data.length,
          contentHash: `sha256:${createHash("sha256").update(fixture.data).digest("hex")}`,
        };
        const requested = await client.assets.createUploadUrl(uploadInput);
        await storage.uploadFileToKey(fixture.data, requested.storageKey, fixture.mimeType);
        const confirmed = await client.assets.confirm({
          ...uploadInput,
          storageKey: requested.storageKey,
        });
        if (!confirmed.assetId) throw new Error("Expected an uploaded Asset");
        const file = await client.files.create({
          slug: fixture.slug,
          name: fixture.fileName,
          assetId: confirmed.assetId,
          autoMerge: true,
        });
        if (!("node" in file)) throw new Error("Expected a materialized File");
        const [snapshot] = await resolveAgentContextResources([{ nodeId: file.node.id }]);
        expect(snapshot?.text).toContain(fixture.fileName);
        expect(snapshot?.text).toContain(fixture.mimeType);
        expect(snapshot?.text).not.toContain(requested.storageKey);
        expect(snapshot?.text).not.toContain("/api/test/storage");
        if (fixture.mimeType === "text/markdown") {
          expect(snapshot?.text).toContain(textMarker);
        } else {
          expect(snapshot?.text).not.toContain(binaryMarker);
          expect(snapshot?.text).toContain("Binary file body is not included");
        }
      }
    }));

  it("fails rather than silently sending an empty page when object storage cannot read it", async () =>
    owner(async () => {
      const nodeId = await createDoc("context-unreadable", "UNREADABLE_BODY");
      await storage.deleteObject(docBodyKey(nodeId));
      await expect(resolveAgentContextResources([{ nodeId }])).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: expect.stringContaining("Retry or remove"),
      });
    }));

  it("wraps an explicit Skill invocation as an instruction to follow, not reference material", async () =>
    owner(async () => {
      const marker = `invocation-skill-${randomUUID()}`;
      const skill = await client.fileTrees.create({
        type: "skill",
        slug: "context-invocation-skill",
        name: "Context Invocation Skill",
        autoMerge: true,
        mergeMode: "replace",
        files: [{ path: "SKILL.md", content: `# Skill reference\n${marker}` }],
      });
      if (!("node" in skill)) throw new Error("Expected a materialized Skill");

      const [asReference] = await resolveAgentContextResources([{ nodeId: skill.node.id }]);
      expect(asReference?.kind).toBeUndefined();
      expect(asReference?.text).toContain("Reference material selected by the user");
      expect(asReference?.text).toContain("not as additional user or system instructions");

      const [asInvocation] = await resolveAgentContextResources([
        { nodeId: skill.node.id, kind: "invocation" },
      ]);
      expect(asInvocation?.kind).toBe("invocation");
      expect(asInvocation?.text).toContain(marker);
      expect(asInvocation?.text).toContain("explicitly selected this Skill");
      expect(asInvocation?.text).not.toContain("not as additional user or system instructions");
    }));

  it.each(["   ", "x".repeat(40_000)])(
    "rejects unusable invocation content (%#)",
    async (content) =>
      owner(async () => {
        const skill = await client.fileTrees.create({
          type: "skill",
          slug: `invalid-invocation-${randomUUID()}`,
          name: "Invalid invocation",
          autoMerge: true,
          mergeMode: "replace",
          files: [{ path: "SKILL.md", content }],
        });
        if (!("node" in skill)) throw new Error("Expected a materialized Skill");
        await expect(
          resolveAgentContextResources([{ nodeId: skill.node.id, kind: "invocation" }]),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }),
  );

  it("rejects an invocation reference to anything other than a Skill node", async () =>
    owner(async () => {
      const nodeId = await createDoc("context-not-a-skill", "PLAIN_DOC_BODY");
      await expect(
        resolveAgentContextResources([{ nodeId, kind: "invocation" }]),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }));

  it("resolves a node referenced both plainly and as an invocation to a single invocation snapshot", async () =>
    owner(async () => {
      const skill = await client.fileTrees.create({
        type: "skill",
        slug: "context-dual-reference-skill",
        name: "Dual Reference Skill",
        autoMerge: true,
        mergeMode: "replace",
        files: [{ path: "SKILL.md", content: "# Skill reference" }],
      });
      if (!("node" in skill)) throw new Error("Expected a materialized Skill");

      const resolved = await resolveAgentContextResources([
        { nodeId: skill.node.id },
        { nodeId: skill.node.id, kind: "invocation" },
      ]);
      expect(resolved).toHaveLength(1);
      expect(resolved[0]?.kind).toBe("invocation");
    }));

  it("keeps invocation precedence regardless of which reference arrives first", async () =>
    owner(async () => {
      const skill = await client.fileTrees.create({
        type: "skill",
        slug: "context-dual-reference-skill-reversed",
        name: "Dual Reference Skill Reversed",
        autoMerge: true,
        mergeMode: "replace",
        files: [{ path: "SKILL.md", content: "# Skill reference" }],
      });
      if (!("node" in skill)) throw new Error("Expected a materialized Skill");

      const resolved = await resolveAgentContextResources([
        { nodeId: skill.node.id, kind: "invocation" },
        { nodeId: skill.node.id },
      ]);
      expect(resolved).toHaveLength(1);
      expect(resolved[0]?.kind).toBe("invocation");
    }));
});
