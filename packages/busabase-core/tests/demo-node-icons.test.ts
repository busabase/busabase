import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NodeIconSchema, type NodeVO } from "busabase-contract/types";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { busabaseNodes } from "../src/db/schema";
import { buildDemoDataset, englishScenario } from "../src/demo/dataset";
import { zhCnScenario } from "../src/demo/scenarios/zh-cn";
import type { SeedScenario } from "../src/demo/seed-types";
import { AIRAPP_DEMO_FUMADOCS } from "../src/domains/airapp/demo-content";
import { listAirAppFiles, readAirAppFile } from "../src/domains/airapp/handlers";
import { writeFileTreeTextFile } from "../src/domains/filetree/handlers";
import { seedScenario } from "../src/logic/store";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const flattenNodes = (nodes: NodeVO[]): NodeVO[] =>
  nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);

const scenarioNodeDefinitions = (scenario: SeedScenario) => [
  ...(scenario.folders ?? []),
  ...(scenario.bases ?? []),
  ...(scenario.docs ?? []),
  ...(scenario.files ?? []),
  ...(scenario.fileTreeNodes ?? []),
  ...(scenario.richNodes ?? []),
  ...(scenario.forms ?? []),
];

const expectValidEmojiIcons = (nodes: Array<{ icon?: unknown; slug: string }>) => {
  const failures = nodes.flatMap((node) => {
    const parsed = NodeIconSchema.safeParse(node.icon);
    if (!parsed.success || parsed.data.type !== "emoji" || parsed.data.value.trim().length === 0) {
      return [node.slug];
    }
    return [];
  });
  expect(failures).toEqual([]);
};

describe.each([
  ["English", englishScenario],
  ["Simplified Chinese", zhCnScenario],
])("%s demo node icons", (_locale, scenario) => {
  it("materializes a valid emoji icon on every shipped seed definition", () => {
    expectValidEmojiIcons(scenarioNodeDefinitions(scenario));
  });

  it("emits valid, content-specific icons from the stateless demo", () => {
    const nodes = flattenNodes(
      buildDemoDataset("1", new Date("2026-08-26T00:00:00Z"), scenario).nodes,
    );
    expectValidEmojiIcons(nodes);

    const emojiValues = new Set(
      nodes.flatMap((node) => (node.icon?.type === "emoji" ? [node.icon.value] : [])),
    );
    expect(emojiValues.size).toBeGreaterThan(20);
    expect(nodes.find((node) => node.slug === "root")?.icon).toEqual({
      type: "emoji",
      value: "🏠",
    });
    expect(nodes.find((node) => node.slug === "blog")?.icon).toEqual({
      type: "emoji",
      value: "📝",
    });
  });
});

describe("real database demo node icons", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-node-icons-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-node-icons-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(originalCwd);
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });

  it("writes icons and backfills every existing demo node on rerun", async () => {
    await seedScenario(englishScenario);
    const db = await getDb();
    const initialNodes = await db
      .select({ icon: busabaseNodes.icon, id: busabaseNodes.id, slug: busabaseNodes.slug })
      .from(busabaseNodes);

    expectValidEmojiIcons(initialNodes);
    expect(initialNodes.find((node) => node.id === "nod_root")?.icon).toEqual({
      type: "emoji",
      value: "🏠",
    });
    expect(initialNodes.find((node) => node.id === "nod_skills")?.icon).toEqual({
      type: "emoji",
      value: "🧰",
    });
    expect(initialNodes.find((node) => node.id === "nod_grep_demo_invoice")?.icon).toEqual({
      type: "emoji",
      value: "🧾",
    });

    const [fumadocsNode] = await db
      .select()
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, "nod_airapp_fumadocs_demo"))
      .limit(1);
    if (!fumadocsNode) throw new Error("Fumadocs seed node was not created");
    await writeFileTreeTextFile(
      fumadocsNode,
      "content/docs/index.mdx",
      "stale content from an older seed",
    );

    await db.update(busabaseNodes).set({ icon: null });
    await seedScenario(englishScenario);

    const backfilledNodes = await db
      .select({ icon: busabaseNodes.icon, id: busabaseNodes.id, slug: busabaseNodes.slug })
      .from(busabaseNodes);
    expect(backfilledNodes).toHaveLength(initialNodes.length);
    expectValidEmojiIcons(backfilledNodes);

    const seededFumadocsNodes = backfilledNodes.filter(
      (node) => node.slug === AIRAPP_DEMO_FUMADOCS.slug,
    );
    expect(seededFumadocsNodes).toHaveLength(1);

    const [seededFumadocs] = await db
      .select()
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, "nod_airapp_fumadocs_demo"))
      .limit(1);
    const airAppFolders = await db
      .select()
      .from(busabaseNodes)
      .where(eq(busabaseNodes.slug, "airapps"));
    expect(airAppFolders).toHaveLength(1);
    expect(seededFumadocs?.parentId).toBe(airAppFolders[0]?.id);

    const files = await listAirAppFiles("nod_airapp_fumadocs_demo");
    expect(files).toHaveLength(AIRAPP_DEMO_FUMADOCS.files.length);
    const indexPage = await readAirAppFile("nod_airapp_fumadocs_demo", "content/docs/index.mdx");
    expect(indexPage.content).toBe(
      AIRAPP_DEMO_FUMADOCS.files.find((file) => file.path === "content/docs/index.mdx")?.content,
    );
  }, 60_000);
});
