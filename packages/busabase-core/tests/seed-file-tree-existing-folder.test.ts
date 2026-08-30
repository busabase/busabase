import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID } from "../src/context";
import { getDb } from "../src/db";
import { busabaseNodes } from "../src/db/schema";
import { englishScenario } from "../src/demo/dataset";
import { ensureReady, seedScenario } from "../src/logic/store";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const EXISTING_SKILLS_FOLDER_ID = "nod_existing_skills";
const OTHER_SPACE_SKILLS_FOLDER_ID = "nod_other_space_skills";

describe("file-tree seed folder adoption", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-file-tree-seed-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-file-tree-seed-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;

    await ensureReady();
    const db = await getDb();
    const createdAt = new Date("2026-08-28T00:00:00.000Z");
    await db.insert(busabaseNodes).values([
      {
        id: OTHER_SPACE_SKILLS_FOLDER_ID,
        spaceId: "other-space",
        parentId: null,
        type: "folder",
        slug: "skills",
        name: "Other workspace skills",
        description: "Must not be adopted by the local seed.",
        position: 1,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: EXISTING_SKILLS_FOLDER_ID,
        parentId: "nod_root",
        type: "folder",
        slug: "skills",
        name: "Existing Agent Skills",
        description: "Production folder created before the canonical seed id existed.",
        position: 1,
        createdAt,
        updatedAt: createdAt,
      },
    ]);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(originalCwd);
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });

  it("reuses the active same-space folder and remains idempotent", async () => {
    await seedScenario(englishScenario);
    const db = await getDb();

    const localSkillsFolders = await db
      .select({ id: busabaseNodes.id })
      .from(busabaseNodes)
      .where(
        and(
          eq(busabaseNodes.spaceId, LOCAL_SPACE_ID),
          eq(busabaseNodes.type, "folder"),
          eq(busabaseNodes.slug, "skills"),
        ),
      );
    expect(localSkillsFolders).toEqual([{ id: EXISTING_SKILLS_FOLDER_ID }]);

    const [seededSkill] = await db
      .select({ parentId: busabaseNodes.parentId })
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, "nod_skill_ai_research_editor"))
      .limit(1);
    expect(seededSkill?.parentId).toBe(EXISTING_SKILLS_FOLDER_ID);

    const [otherSpaceFolder] = await db
      .select({ name: busabaseNodes.name })
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, OTHER_SPACE_SKILLS_FOLDER_ID))
      .limit(1);
    expect(otherSpaceFolder?.name).toBe("Other workspace skills");

    const nodeCountBeforeRerun = (await db.select({ id: busabaseNodes.id }).from(busabaseNodes))
      .length;
    await seedScenario(englishScenario);
    const nodeCountAfterRerun = (await db.select({ id: busabaseNodes.id }).from(busabaseNodes))
      .length;
    expect(nodeCountAfterRerun).toBe(nodeCountBeforeRerun);

    const [seededSkillAfterRerun] = await db
      .select({ parentId: busabaseNodes.parentId })
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, "nod_skill_ai_research_editor"))
      .limit(1);
    expect(seededSkillAfterRerun?.parentId).toBe(EXISTING_SKILLS_FOLDER_ID);
  }, 60_000);
});
