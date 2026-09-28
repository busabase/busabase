import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NodeVO } from "busabase-contract/types";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { busabaseNodes } from "../src/db/schema";
import { buildDemoDataset, englishScenario } from "../src/demo/dataset";
import { zhCnScenario } from "../src/demo/scenarios/zh-cn";
import { ensureReady, seedScenario } from "../src/logic/store";

const INSURANCE_FOLDER_ID = "nod_insurance";
const INSURANCE_FILE_TREE_NODE_IDS = [
  "nod_airapp_insurance_renewal_board",
  "nod_airapp_insurance_agent_desk",
  "nod_airapp_insurance_agency_scoreboard",
  "nod_airapp_insurance_issuance_desk",
  "nod_skill_policy_renewal_assistant",
  "nod_drive_insurance_materials",
];
// An AirApp from another scenario that sets no folder, so it must stay put.
const SHARED_AIRAPP_SLUG = "demo-pure-html";

const flatten = (nodes: NodeVO[]): NodeVO[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

describe("file-tree nodes seeded into a scenario folder — stateless demo", () => {
  it.each([
    ["English", englishScenario],
    ["Simplified Chinese", zhCnScenario],
  ])("%s: the insurance apps sit inside the Insurance folder", (_label, scenario) => {
    const nodes = flatten(buildDemoDataset("1", new Date("2026-09-28T00:00:00Z"), scenario).nodes);
    const insuranceFolder = nodes.find((node) => node.id === INSURANCE_FOLDER_ID);
    expect(insuranceFolder?.children.map((child) => child.id)).toEqual(
      expect.arrayContaining(INSURANCE_FILE_TREE_NODE_IDS),
    );
    for (const id of INSURANCE_FILE_TREE_NODE_IDS) {
      // Exactly once: moved, not duplicated into the shared per-type folder.
      expect(nodes.filter((node) => node.id === id)).toHaveLength(1);
      expect(nodes.find((node) => node.id === id)?.parentId).toBe(INSURANCE_FOLDER_ID);
    }
  });

  it("keeps AirApps without a folder in the shared AirApps folder", () => {
    const nodes = flatten(
      buildDemoDataset("1", new Date("2026-09-28T00:00:00Z"), englishScenario).nodes,
    );
    expect(nodes.find((node) => node.slug === SHARED_AIRAPP_SLUG)?.parentId).toBe("nod_airapps");
  });

  it("does not leave an empty AirApps folder when every AirApp moved out", () => {
    // The zh-CN set's only AirApps are the insurance ones.
    const nodes = flatten(
      buildDemoDataset("1", new Date("2026-09-28T00:00:00Z"), zhCnScenario).nodes,
    );
    expect(nodes.some((node) => node.type === "airapp" && node.parentId === "nod_airapps")).toBe(
      false,
    );
    expect(nodes.find((node) => node.id === "nod_airapps")).toBeUndefined();
  });
});

describe("file-tree nodes seeded into a scenario folder — real seed", () => {
  const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-file-tree-folder-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-file-tree-folder-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;

    await ensureReady();
    // A workspace seeded before this change: the renewal board already lives in
    // the shared AirApps folder. Re-seeding has to move it, not leave it behind.
    const db = await getDb();
    const createdAt = new Date("2026-09-01T00:00:00.000Z");
    await db.insert(busabaseNodes).values([
      {
        id: "nod_airapps",
        parentId: "nod_root",
        type: "folder",
        slug: "airapps",
        name: "AirApps",
        description: "Seeded before scenario folders existed.",
        position: 5,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "nod_airapp_insurance_renewal_board",
        parentId: "nod_airapps",
        type: "airapp",
        slug: "insurance-renewal-board",
        name: "Renewal Board",
        description: "Seeded before scenario folders existed.",
        position: 6,
        createdAt,
        updatedAt: createdAt,
      },
    ]);

    await seedScenario(englishScenario);
  }, 120_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(originalCwd);
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });

  const parentOf = async (id: string) => {
    const db = await getDb();
    const [node] = await db
      .select({ parentId: busabaseNodes.parentId })
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, id))
      .limit(1);
    return node?.parentId;
  };

  it("seeds each insurance app inside the Insurance folder, moving one that already existed", async () => {
    for (const id of INSURANCE_FILE_TREE_NODE_IDS) {
      expect(await parentOf(id)).toBe(INSURANCE_FOLDER_ID);
    }
  });

  it("keeps AirApps without a folder in the shared AirApps folder", async () => {
    const db = await getDb();
    const [shared] = await db
      .select({ parentId: busabaseNodes.parentId })
      .from(busabaseNodes)
      .where(eq(busabaseNodes.slug, SHARED_AIRAPP_SLUG))
      .limit(1);
    expect(shared?.parentId).toBe("nod_airapps");
  });
});
