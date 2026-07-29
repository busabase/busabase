import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommitPO, NodePO, OperationPO } from "../src/db/schema";
import { mergeSkillFile, mergeSkillMetadata } from "../src/domains/skill/handlers";
import type { MergeCtx } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Integration coverage for the Agent Skills API, exercised through the real oRPC
 * router (input + contract output validation) — not the bare handlers. Every
 * `skills.*` procedure plus the change-request lifecycle (review → merge) that
 * mutates Skill nodes is driven via `createRouterClient(busabaseRouter)`, so the
 * tests run the exact code path an HTTP/RPC caller hits.
 *
 * Two skill-merge guard branches are unreachable through the public API (the
 * merge dispatcher only ever calls them with a valid skill node + file path), so
 * they are covered by a direct call at the bottom — clearly isolated.
 */

type SkillsClient = ReturnType<
  typeof createRouterClient<typeof busabaseRouter, Record<never, never>>
>;

// PGlite migrations are an app artifact resolved from `process.cwd()/src/db/
// migrations`; busabase-core has none of its own, so the test runs against the
// reference app's migrations (busabase). Same schema, owned by busabase-core.
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const API = "http://busabase.test/api/v1";
describe("Agent Skills API — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: SkillsClient;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-skills-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-skills-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) {
      process.chdir(originalCwd);
    }
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  const approveAndMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({
      changeRequestIds: [changeRequestId],
      verdict: "approved",
    });
    const [result] = (await client.changeRequests.merge({ changeRequestIds: [changeRequestId] }))
      .results;
    if (!result?.ok)
      throw Object.assign(new Error(result?.error ?? "Change request merge returned no result"), {
        code: result?.code,
        data: result?.data,
      });
    return result;
  };

  const createAsset = async (input: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    contentHash: string;
  }) => {
    const request = await client.assets.createUploadUrl(input);
    const confirmed = await client.assets.confirm({
      storageKey: request.storageKey,
      ...input,
    });
    return {
      ...(await client.assets.get({ assetId: confirmed.assetId as string })).asset,
      assetId: confirmed.assetId as string,
    };
  };

  it("lists created skills with their Asset-backed file trees", async () => {
    await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      slug: "ai-research-editor",
      name: "AI Research Editor",
      description: "Reviews agent research drafts for source quality before publishing.",
    });

    // The unified list is a SUMMARY projection: node rows only, no per-node
    // file inventory (that N+1 is exactly what this consolidation removed).
    const skills = await client.nodes.list({ types: ["skill"] });
    const listed = skills.find((skill) => skill.slug === "ai-research-editor");
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty("files");
    expect(listed?.children).toEqual([]);

    // The detail — files, entry file, visibility, version — comes from opening it.
    const detail = await client.nodes.get({ nodeId: "ai-research-editor", type: "skill" });
    expect(detail.type).toBe("skill");
    expect(detail.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["SKILL.md", "skill.json"]),
    );
    expect(detail.entryFile).toBe("SKILL.md");
    expect(detail.visibility).toBeDefined();
    expect(detail.version).toBeDefined();
  });

  it("creates a skill, seeding default SKILL.md + skill.json when none are supplied", async () => {
    const created = await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      slug: "launch-writer",
      name: "Launch Writer",
      description: "Drafts launch posts with a review checklist.",
      files: [{ path: "references/tone.md", content: "Tone: concise.\n" }],
    });

    expect(created.node.type).toBe("skill");
    expect(created.visibility).toBe("private");
    expect(created.version).toBe("0.1.0");
    const paths = created.files.map((file) => file.path);
    expect(paths).toEqual(expect.arrayContaining(["SKILL.md", "skill.json", "references/tone.md"]));

    const skillMd = await client.fileTrees.readFile({
      type: "skill",
      nodeId: created.node.id,
      filePath: "SKILL.md",
    });
    expect(skillMd.content).toContain("Launch Writer");
    expect(skillMd.contentHash).toMatch(/^sha256:/);
  });

  it("honours caller-supplied SKILL.md / skill.json instead of the defaults", async () => {
    const created = await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      slug: "custom-entry",
      name: "Custom Entry",
      visibility: "workspace",
      version: "2.0.0",
      files: [
        { path: "SKILL.md", content: "---\nname: custom-entry\n---\n\n# Custom\n" },
        { path: "skill.json", content: '{ "name": "custom-entry" }\n' },
      ],
    });

    expect(created.visibility).toBe("workspace");
    expect(created.version).toBe("2.0.0");
    const skillMd = await client.fileTrees.readFile({
      type: "skill",
      nodeId: created.node.id,
      filePath: "SKILL.md",
    });
    expect(skillMd.content).toContain("# Custom");
  });

  it("is idempotent on slug — re-creating returns the existing skill", async () => {
    const first = await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      slug: "dedup-skill",
      name: "Dedup Skill",
    });
    const second = await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      slug: "dedup-skill",
      name: "Different Name",
    });
    expect(second.node.id).toBe(first.node.id);
  });

  it("rejects creation under a missing / non-folder parent", async () => {
    await expect(
      client.fileTrees.create({
        type: "skill",
        autoMerge: true,
        slug: "orphan-skill",
        name: "Orphan",
        parentNodeId: "pnd_does_not_exist",
      }),
    ).rejects.toThrow(/Parent node not found/);
  });

  it("gets a skill by node id and by slug, and 404s an unknown one", async () => {
    const created = await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      slug: "gettable",
      name: "Gettable",
    });
    const byId = await client.nodes.get({ nodeId: created.node.id, type: "skill" });
    const bySlug = await client.nodes.get({ nodeId: "gettable", type: "skill" });
    expect(byId.node.id).toBe(created.node.id);
    expect(bySlug.node.id).toBe(created.node.id);

    await expect(client.nodes.get({ nodeId: "pnd_missing", type: "skill" })).rejects.toThrow(
      /Node not found/,
    );
  });

  it("lists files and reads a file, 404ing unknown skills", async () => {
    const created = await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      slug: "filey",
      name: "Filey",
    });
    const files = await client.fileTrees.listFiles({ type: "skill", nodeId: created.node.id });
    expect(files.some((file) => file.path === "SKILL.md")).toBe(true);

    await expect(
      client.fileTrees.listFiles({ type: "skill", nodeId: "pnd_missing" }),
    ).rejects.toThrow(/Skill not found/);
    await expect(
      client.fileTrees.readFile({ type: "skill", nodeId: "pnd_missing", filePath: "SKILL.md" }),
    ).rejects.toThrow(/Skill not found/);
  });

  it("creates a skill change request and merges a file update", async () => {
    const skill = await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      slug: "cr-update",
      name: "CR Update",
    });
    const current = await client.fileTrees.readFile({
      type: "skill",
      nodeId: skill.node.id,
      filePath: "SKILL.md",
    });

    const changeRequest = await client.fileTrees.createChangeRequest({
      type: "skill",
      nodeId: skill.node.id,
      message: "Add review checklist",
      submittedBy: "vitest-agent",
      operations: [
        {
          kind: "update",
          path: "SKILL.md",
          content: `${current.content}\n## Checklist\n\n- Verify sources.\n`,
          baseContentHash: current.contentHash,
        },
      ],
    });
    expect(changeRequest.status).toBe("in_review");
    expect(changeRequest.primaryOperation?.operation).toBe("skill_file_update");

    await approveAndMerge(changeRequest.id);
    const updated = await client.fileTrees.readFile({
      type: "skill",
      nodeId: skill.node.id,
      filePath: "SKILL.md",
    });
    expect(updated.content).toContain("## Checklist");
  });

  it("uploads and reads arbitrary Skill files as asset refs through the RPC change-request flow", async () => {
    const asset = await createAsset({
      fileName: "runtime.wasm",
      mimeType: "application/wasm",
      sizeBytes: 8,
      contentHash: `sha256:${"e".repeat(64)}`,
    });
    const skill = await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      slug: "asset-file-skill",
      name: "Asset File Skill",
    });
    const changeRequest = await client.fileTrees.createChangeRequest({
      type: "skill",
      nodeId: skill.node.id,
      message: "Add runtime fixture",
      operations: [
        {
          kind: "create",
          path: "fixtures/runtime.wasm",
          assetId: asset.assetId,
          displayName: "Runtime WASM",
          mimeType: "application/wasm",
        },
      ],
    });
    expect(changeRequest.primaryOperation?.operation).toBe("skill_file_create");

    await approveAndMerge(changeRequest.id);
    const file = await client.fileTrees.readFile({
      type: "skill",
      nodeId: skill.node.id,
      filePath: "fixtures/runtime.wasm",
    });
    expect(file).toMatchObject({
      encoding: "url",
      content: "",
      mimeType: "application/wasm",
      assetId: asset.assetId,
      displayName: "Runtime WASM",
    });
  });

  it("uploads and reads arbitrary Skill files as asset refs through the public OpenAPI route", async () => {
    const handler = new OpenAPIHandler(busabaseRouter);
    const call = async (method: string, routePath: string, body?: unknown) => {
      const request = new Request(`${API}${routePath}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await handler.handle(request, { context: {} });
      if (!result.matched) {
        throw new Error(`no OpenAPI route matched ${method} ${routePath}`);
      }
      return { status: result.response.status, body: await result.response.json() };
    };
    const ok = async (method: string, routePath: string, body?: unknown) => {
      const result = await call(method, routePath, body);
      if (result.status >= 400) {
        throw new Error(
          `${method} ${routePath} -> ${result.status}: ${JSON.stringify(result.body)}`,
        );
      }
      return result.body;
    };

    const asset = await createAsset({
      fileName: "runtime.wasm",
      mimeType: "application/wasm",
      sizeBytes: 8,
      contentHash: `sha256:${"f".repeat(64)}`,
    });
    const skill = await ok("POST", "/file-trees", {
      type: "skill",
      autoMerge: true,
      slug: "openapi-asset-file-skill",
      name: "OpenAPI Asset File Skill",
    });
    const legacyUpload = await call("POST", `/file-trees/${skill.node.id}/change-requests`, {
      message: "Legacy direct binary upload",
      operations: [
        {
          kind: "create",
          path: "fixtures/legacy.wasm",
          contentBase64: "AA==",
          mimeType: "application/wasm",
        },
      ],
    });
    expect(legacyUpload.status).toBeGreaterThanOrEqual(400);

    const changeRequest = await ok("POST", `/file-trees/${skill.node.id}/change-requests`, {
      message: "Add REST runtime fixture",
      operations: [
        {
          kind: "create",
          path: "fixtures/runtime.wasm",
          assetId: asset.assetId,
          displayName: "REST Runtime WASM",
          mimeType: "application/wasm",
        },
      ],
    });
    await ok("POST", "/change-requests/reviews", {
      changeRequestIds: [changeRequest.id],
      verdict: "approved",
    });
    await ok("POST", "/change-requests/merge", { changeRequestIds: [changeRequest.id] });

    const file = await ok("GET", `/file-trees/${skill.node.id}/files/fixtures/runtime.wasm`);
    expect(file.encoding).toBe("url");
    expect(file.assetId).toBe(asset.assetId);
    expect(file.displayName).toBe("REST Runtime WASM");
    expect(file.mimeType).toBe("application/wasm");
  });

  it("merges create + delete file operations", async () => {
    const skill = await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      slug: "cr-files",
      name: "CR Files",
    });

    const createCr = await client.fileTrees.createChangeRequest({
      type: "skill",
      nodeId: skill.node.id,
      operations: [{ kind: "create", path: "references/extra.md", content: "extra\n" }],
    });
    expect(createCr.primaryOperation?.operation).toBe("skill_file_create");
    await approveAndMerge(createCr.id);
    expect(
      (await client.fileTrees.listFiles({ type: "skill", nodeId: skill.node.id })).some(
        (file) => file.path === "references/extra.md",
      ),
    ).toBe(true);

    const deleteCr = await client.fileTrees.createChangeRequest({
      type: "skill",
      nodeId: skill.node.id,
      operations: [{ kind: "delete", path: "references/extra.md" }],
    });
    expect(deleteCr.primaryOperation?.operation).toBe("skill_file_delete");
    await approveAndMerge(deleteCr.id);
    expect(
      (await client.fileTrees.listFiles({ type: "skill", nodeId: skill.node.id })).some(
        (file) => file.path === "references/extra.md",
      ),
    ).toBe(false);
  });

  it("merges a metadata_update operation", async () => {
    const skill = await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      slug: "cr-meta",
      name: "CR Meta",
    });
    const metaCr = await client.fileTrees.createChangeRequest({
      type: "skill",
      nodeId: skill.node.id,
      operations: [
        { kind: "metadata_update", metadata: { version: "9.9.9", visibility: "public" } },
      ],
    });
    expect(metaCr.primaryOperation?.operation).toBe("skill_metadata_update");
    await approveAndMerge(metaCr.id);

    const after = await client.nodes.get({ nodeId: skill.node.id, type: "skill" });
    expect(after.version).toBe("9.9.9");
    expect(after.visibility).toBe("public");
  });

  it("blocks a stale file merge when baseContentHash no longer matches", async () => {
    const skill = await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      slug: "cr-stale",
      name: "CR Stale",
    });
    const staleCr = await client.fileTrees.createChangeRequest({
      type: "skill",
      nodeId: skill.node.id,
      operations: [
        {
          kind: "update",
          path: "SKILL.md",
          content: "rewritten\n",
          baseContentHash:
            "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
      ],
    });
    await client.changeRequests.review({
      changeRequestIds: [staleCr.id],
      verdict: "approved",
    });
    const mergeResult = await client.changeRequests.merge({ changeRequestIds: [staleCr.id] });
    expect(mergeResult.results[0]).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Skill file changed before merge/),
    });
  });

  it("404s a change request against an unknown skill", async () => {
    await expect(
      client.fileTrees.createChangeRequest({
        type: "skill",
        nodeId: "pnd_missing",
        operations: [{ kind: "update", path: "SKILL.md", content: "x" }],
      }),
    ).rejects.toThrow(/Skill not found/);
  });

  it("materializes a Skill node from a node_create change request", async () => {
    // Two creates in one request: one with a description, one without — covers
    // both sides of the `description ?? …` fallbacks in materializeSkillNode.
    const nodeCr = await client.nodes.createChangeRequest({
      operations: [
        {
          kind: "create",
          nodeType: "skill",
          slug: "materialized-skill",
          name: "Materialized",
          description: "A materialized skill with a description.",
        },
        { kind: "create", nodeType: "skill", slug: "materialized-bare", name: "Materialized Bare" },
      ],
      submittedBy: "vitest-agent",
    });
    const merged = await approveAndMerge(nodeCr.id);
    const mergedNodeIds = merged.changeRequest.mergeSummary.mergedNodeIds;
    expect(Array.isArray(mergedNodeIds) ? mergedNodeIds : []).toHaveLength(2);
    const newNodeId = String(Array.isArray(mergedNodeIds) ? mergedNodeIds[0] : "");
    expect(newNodeId).toMatch(/^nod/);

    const skill = await client.nodes.get({ nodeId: newNodeId, type: "skill" });
    expect(skill.node.slug).toBe("materialized-skill");
    expect(skill.files.some((file) => file.path === "SKILL.md")).toBe(true);
  });

  it("rejects legacy direct-binary commit fields instead of writing an empty text file", async () => {
    await expect(
      mergeSkillFile(
        {} as MergeCtx,
        {
          id: "qop_legacy",
          operation: "skill_file_create",
          filePath: "bin/runtime.wasm",
        } as OperationPO,
        { type: "skill" } as NodePO,
        {
          fields: {
            encoding: "base64",
            nextContentBase64: "AA==",
            mimeType: "application/wasm",
          },
        } as unknown as CommitPO,
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("legacy direct binary file commits"),
    });
  });

  // --- guard branches unreachable through the dispatcher ----------------------
  // The merge dispatcher only invokes these with a valid skill node + file path.
  // Cover the defensive throws directly so the file reaches full coverage.
  it("guards skill merge handlers against invalid targets", async () => {
    const ctx = {} as MergeCtx;
    const commit = {} as CommitPO;

    await expect(
      mergeSkillFile(
        ctx,
        { id: "qop_x", filePath: "SKILL.md" } as OperationPO,
        { type: "folder" } as NodePO,
        commit,
      ),
    ).rejects.toThrow(/Invalid skill file operation target/);

    await expect(
      mergeSkillFile(
        ctx,
        { id: "qop_y", filePath: null } as unknown as OperationPO,
        { type: "skill" } as NodePO,
        commit,
      ),
    ).rejects.toThrow(/Invalid skill file operation target/);

    await expect(
      mergeSkillMetadata(ctx, { id: "qop_z" } as OperationPO, { type: "folder" } as NodePO, commit),
    ).rejects.toThrow(/Invalid skill metadata operation target/);
  });
});
