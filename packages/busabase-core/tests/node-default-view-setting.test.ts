import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { nodeSettingsSchema } from "busabase-contract/contract/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * `settings.defaultViewSlug` on a Base node: accepted by the closed settings
 * schema, validated against the Base's active views on write, and dropped
 * again when a merged delete archives the view it named.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("nodeSettingsSchema", () => {
  it("accepts defaultViewSlug and null to clear it", () => {
    expect(nodeSettingsSchema.parse({ defaultViewSlug: "board" })).toEqual({
      defaultViewSlug: "board",
    });
    expect(nodeSettingsSchema.parse({ defaultViewSlug: null })).toEqual({ defaultViewSlug: null });
  });

  it("still rejects an unknown key", () => {
    expect(() => nodeSettingsSchema.parse({ defaultView: "board" })).toThrow();
  });
});

describe("Base default view setting", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let baseNodeId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-default-view-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-default-view-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });
    const blog = (await client.bases.list({})).find((base) => base.slug === "blog");
    baseId = blog?.id ?? "";
    baseNodeId = blog?.nodeId ?? "";
    expect(baseId).not.toBe("");
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const readDefaultView = async () =>
    (await client.nodes.get({ nodeId: baseNodeId, type: "base" })).node.settings?.defaultViewSlug ??
    null;

  it("stores the slug of an active view, and clears it when that view is deleted", async () => {
    const created = await client.views.changeRequest({
      operation: "create",
      baseId,
      slug: "dv-board",
      name: "Board",
    });
    if (!created.materialized) throw new Error("expected the view to merge at once");

    const patched = await client.nodes.updateSettings({
      nodeId: baseNodeId,
      settings: { defaultViewSlug: "dv-board" },
    });
    expect(patched.settings?.defaultViewSlug).toBe("dv-board");
    expect(await readDefaultView()).toBe("dv-board");

    await client.views.changeRequest({ operation: "delete", viewId: created.id });
    expect(await readDefaultView()).toBeNull();
  });

  it("leaves the setting alone when a different view is deleted", async () => {
    const keep = await client.views.changeRequest({
      operation: "create",
      baseId,
      slug: "dv-keep",
      name: "Keep",
    });
    const other = await client.views.changeRequest({
      operation: "create",
      baseId,
      slug: "dv-other",
      name: "Other",
    });
    if (!keep.materialized || !other.materialized) throw new Error("expected merged views");

    await client.nodes.updateSettings({
      nodeId: baseNodeId,
      settings: { defaultViewSlug: "dv-keep" },
    });
    await client.views.changeRequest({ operation: "delete", viewId: other.id });
    expect(await readDefaultView()).toBe("dv-keep");

    await client.nodes.updateSettings({ nodeId: baseNodeId, settings: { defaultViewSlug: null } });
    expect(await readDefaultView()).toBeNull();
  });

  it("rejects a slug that names no active view of the Base", async () => {
    await expect(
      client.nodes.updateSettings({
        nodeId: baseNodeId,
        settings: { defaultViewSlug: "dv-missing" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects the key on a node that is not a Base", async () => {
    const folder = (await client.nodes.list({})).find((node) => node.type === "folder");
    expect(folder).toBeDefined();
    await expect(
      client.nodes.updateSettings({
        nodeId: folder?.id ?? "",
        settings: { defaultViewSlug: "dv-board" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
