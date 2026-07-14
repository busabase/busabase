import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";

/**
 * Integration coverage for the AirApp API — exercised through the real oRPC
 * router (input + contract output validation), not the bare handlers. AirApp
 * is a file-tree-backed node type (same `filetree/handlers.ts` machinery as
 * drive/skill, see `src/domains/airapp/handlers.ts`'s `airappFileTreeConfig`)
 * whose seed files produce a runnable Hono HTTP server project. This file
 * covers only the CRUD / file-operation / change-request surface — the
 * in-browser Nodepod "Run" behavior has no server-side component and is
 * covered by `apps/busabase/tests/e2e/airapp.spec.ts` instead.
 */

type AirAppClient = ReturnType<
  typeof createRouterClient<typeof busabaseRouter, Record<never, never>>
>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const AIRAPP_SEED_PATHS = ["package.json", "server.js", "index.html", "style.css", "client.js"];

describe("AirApp API — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: AirAppClient;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-airapp-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-airapp-storage-"));
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
    await client.changeRequests.review({ changeRequestId, verdict: "approved" });
    return client.changeRequests.merge({ changeRequestId });
  };

  it("creates an AirApp with the default runnable Hono seed project", async () => {
    const created = await client.airapps.create({
      autoMerge: true,
      slug: "hello-airapp",
      name: "Hello AirApp",
      description: "A tiny Hono server.",
    });

    expect(created.node.type).toBe("airapp");
    expect(created.node.slug).toBe("hello-airapp");
    expect(created.node.name).toBe("Hello AirApp");
    expect(created.node.description).toBe("A tiny Hono server.");
    expect(created.entryFile).toBe("package.json");
    expect(created.files.map((file) => file.path).sort()).toEqual([...AIRAPP_SEED_PATHS].sort());
  });

  it("replaces the default seed files with caller-supplied files when mergeMode is replace", async () => {
    const created = await client.airapps.create({
      autoMerge: true,
      slug: "custom-airapp",
      name: "Custom AirApp",
      mergeMode: "replace",
      files: [
        {
          path: "package.json",
          content: JSON.stringify(
            { name: "custom-airapp", private: true, scripts: { dev: "node server.js" } },
            null,
            2,
          ),
        },
        { path: "server.js", content: "console.log('custom server');\n" },
      ],
    });

    // Exactly the custom file set — none of the default seed's other files
    // (index.html/style.css/client.js) should be layered in.
    expect(created.files.map((file) => file.path).sort()).toEqual(["package.json", "server.js"]);

    const serverFile = await client.airapps.readFile({
      nodeId: created.node.id,
      filePath: "server.js",
    });
    expect(serverFile.content).toBe("console.log('custom server');\n");
  });

  it("proposes a pending ChangeRequest by default and only materializes the node on merge", async () => {
    const proposal = await client.airapps.create({
      slug: "review-first-airapp",
      name: "Review First AirApp",
    });

    expect(proposal.status).toBe("in_review");
    expect(proposal.primaryOperation?.operation).toBe("node_create");

    // Not yet visible via list/get — it hasn't been materialized.
    const beforeMerge = await client.airapps.list();
    expect(beforeMerge.some((airapp) => airapp.node.slug === "review-first-airapp")).toBe(false);
    await expect(client.airapps.get({ nodeId: "review-first-airapp" })).rejects.toThrow();

    const merged = await approveAndMerge(proposal.id);
    const mergedNodeIds = merged.changeRequest.mergeSummary.mergedNodeIds;
    const newNodeId = String(Array.isArray(mergedNodeIds) ? mergedNodeIds[0] : "");
    expect(newNodeId).toMatch(/^nod/);

    const afterMerge = await client.airapps.get({ nodeId: newNodeId });
    expect(afterMerge.node.slug).toBe("review-first-airapp");
    expect(afterMerge.files.map((file) => file.path).sort()).toEqual([...AIRAPP_SEED_PATHS].sort());

    const listed = await client.airapps.list();
    expect(listed.some((airapp) => airapp.node.slug === "review-first-airapp")).toBe(true);
  });

  it("gets an AirApp by node id with its full file list, and 404s an unknown one", async () => {
    const created = await client.airapps.create({
      autoMerge: true,
      slug: "gettable-airapp",
      name: "Gettable AirApp",
    });

    const byId = await client.airapps.get({ nodeId: created.node.id });
    expect(byId.node.id).toBe(created.node.id);
    expect(byId.files.map((file) => file.path).sort()).toEqual([...AIRAPP_SEED_PATHS].sort());

    const bySlug = await client.airapps.get({ nodeId: "gettable-airapp" });
    expect(bySlug.node.id).toBe(created.node.id);

    await expect(client.airapps.get({ nodeId: "pnd_missing" })).rejects.toThrow(/AirApp not found/);
  });

  it("lists AirApps for the space without leaking other node types", async () => {
    await client.airapps.create({ autoMerge: true, slug: "list-airapp", name: "List AirApp" });
    await client.drives.create({ autoMerge: true, slug: "list-drive", name: "List Drive" });
    await client.skills.create({ autoMerge: true, slug: "list-skill", name: "List Skill" });
    await client.docs.create({ autoMerge: true, slug: "list-doc", name: "List Doc", body: "x\n" });

    const airapps = await client.airapps.list();
    expect(airapps.every((airapp) => airapp.node.type === "airapp")).toBe(true);
    expect(airapps.some((airapp) => airapp.node.slug === "list-airapp")).toBe(true);
    expect(airapps.some((airapp) => airapp.node.slug === "list-drive")).toBe(false);
    expect(airapps.some((airapp) => airapp.node.slug === "list-skill")).toBe(false);
    expect(airapps.some((airapp) => airapp.node.slug === "list-doc")).toBe(false);
  });

  it("lists file metadata and reads full file content with utf8 encoding", async () => {
    const created = await client.airapps.create({
      autoMerge: true,
      slug: "files-airapp",
      name: "Files AirApp",
    });

    const files = await client.airapps.listFiles({ nodeId: created.node.id });
    expect(files.map((file) => file.path).sort()).toEqual([...AIRAPP_SEED_PATHS].sort());
    expect(files.every((file) => typeof file.name === "string" && file.name.length > 0)).toBe(true);

    const packageJson = await client.airapps.readFile({
      nodeId: created.node.id,
      filePath: "package.json",
    });
    expect(packageJson.encoding).toBe("utf8");
    expect(packageJson.content).toContain('"name": "files-airapp"');
    expect(packageJson.content).toContain("hono");
    expect(packageJson.contentHash).toMatch(/^sha256:/);
  });

  it("creates a change request on an existing AirApp and merges a file edit", async () => {
    const created = await client.airapps.create({
      autoMerge: true,
      slug: "editable-airapp",
      name: "Editable AirApp",
    });
    const current = await client.airapps.readFile({
      nodeId: created.node.id,
      filePath: "client.js",
    });

    const changeRequest = await client.airapps.createChangeRequest({
      nodeId: created.node.id,
      message: "Tweak the client script",
      operations: [
        {
          kind: "update",
          path: "client.js",
          content: `${current.content}\nconsole.log("edited");\n`,
          baseContentHash: current.contentHash,
        },
      ],
    });
    expect(changeRequest.status).toBe("in_review");
    expect(changeRequest.primaryOperation?.operation).toBe("airapp_file_update");

    await approveAndMerge(changeRequest.id);
    const updated = await client.airapps.readFile({
      nodeId: created.node.id,
      filePath: "client.js",
    });
    expect(updated.content).toContain('console.log("edited");');
  });

  it("404s a change request against an unknown AirApp", async () => {
    await expect(
      client.airapps.createChangeRequest({
        nodeId: "pnd_missing",
        operations: [{ kind: "update", path: "client.js", content: "x" }],
      }),
    ).rejects.toThrow(/AirApp not found/);
  });

  it("isolates AirApps between spaces — not visible via list/get from another space", async () => {
    const inSpace = <T>(spaceId: string, fn: () => Promise<T>): Promise<T> =>
      runWithBusabaseContext({ spaceId }, fn);

    const createdInA = await inSpace("space_airapp_a", () =>
      client.airapps.create({ autoMerge: true, slug: "space-a-airapp", name: "Space A AirApp" }),
    );
    await inSpace("space_airapp_b", () =>
      client.airapps.create({ autoMerge: true, slug: "space-b-airapp", name: "Space B AirApp" }),
    );

    const listedFromA = await inSpace("space_airapp_a", () => client.airapps.list());
    const listedFromB = await inSpace("space_airapp_b", () => client.airapps.list());
    expect(listedFromA.map((a) => a.node.slug)).toContain("space-a-airapp");
    expect(listedFromA.map((a) => a.node.slug)).not.toContain("space-b-airapp");
    expect(listedFromB.map((a) => a.node.slug)).toContain("space-b-airapp");
    expect(listedFromB.map((a) => a.node.slug)).not.toContain("space-a-airapp");

    // A node id minted in space A is not reachable from space B either.
    await expect(
      inSpace("space_airapp_b", () => client.airapps.get({ nodeId: createdInA.node.id })),
    ).rejects.toThrow(/AirApp not found/);
  });
});
