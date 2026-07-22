import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBusabaseCmsBaseDefinition } from "../../busabase-cms/src/schema";
import { getDb } from "../src/db";
import { busabaseBases, busabaseNodes, busabaseRecords } from "../src/db/schema";
import {
  DEMO_BASES,
  DEMO_CONTENT_FOLDER_NODE_ID,
  DEMO_FOLDERS,
  DEMO_RECORDS,
  DEMO_VIEWS,
} from "../src/demo/dataset";
import {
  CMS_DEMO_AGENT_INTEGRATIONS_BASE_ID,
  CMS_DEMO_BASE_IDS,
  CMS_DEMO_CATEGORIES_BASE_ID,
  CMS_DEMO_FOLDER_NODE_ID,
  CMS_DEMO_PAGES_BASE_ID,
  CMS_DEMO_POSTS_BASE_ID,
  CMS_DEMO_TAG_RECORD_IDS,
  CMS_DEMO_TAGS_BASE_ID,
  withCmsDemoStandard,
} from "../src/demo/scenarios/cms-demo";
import type { SeedScenario } from "../src/demo/seed-types";
import { validateRecordFields } from "../src/domains/base/field-rules";
import type { FieldDef } from "../src/domains/base/field-types";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const roles = ["categories", "tags", "posts", "pages"] as const;

const scenario = withCmsDemoStandard({
  folders: DEMO_FOLDERS,
  bases: DEMO_BASES,
  records: DEMO_RECORDS,
  views: DEMO_VIEWS,
});

const baseById = new Map((scenario.bases ?? []).map((base) => [base.id, base]));
const recordsFor = (baseId: string) =>
  (scenario.records ?? []).filter((record) => record.baseId === baseId);

const PRODUCTION_IDS = {
  folder: "nod_prod_cms",
  duplicateFolder: "nod_prod_duplicate_cms",
  bases: {
    posts: "bse_prod_posts",
    pages: "bse_prod_pages",
    categories: "bse_prod_categories",
    tags: "bse_prod_tags",
  },
  nodes: {
    posts: "nod_prod_posts",
    pages: "nod_prod_pages",
    categories: "nod_prod_categories",
    tags: "nod_prod_tags",
  },
} as const;

const productionBaseIdBySeedId = new Map([
  [CMS_DEMO_POSTS_BASE_ID, PRODUCTION_IDS.bases.posts],
  [CMS_DEMO_PAGES_BASE_ID, PRODUCTION_IDS.bases.pages],
  [CMS_DEMO_CATEGORIES_BASE_ID, PRODUCTION_IDS.bases.categories],
  [CMS_DEMO_TAGS_BASE_ID, PRODUCTION_IDS.bases.tags],
]);

const productionNodeIdBySeedId = new Map([
  [baseById.get(CMS_DEMO_POSTS_BASE_ID)?.nodeId ?? "", PRODUCTION_IDS.nodes.posts],
  [baseById.get(CMS_DEMO_PAGES_BASE_ID)?.nodeId ?? "", PRODUCTION_IDS.nodes.pages],
  [baseById.get(CMS_DEMO_CATEGORIES_BASE_ID)?.nodeId ?? "", PRODUCTION_IDS.nodes.categories],
  [baseById.get(CMS_DEMO_TAGS_BASE_ID)?.nodeId ?? "", PRODUCTION_IDS.nodes.tags],
]);

const productionRecordIdBySeedId = new Map(
  (scenario.records ?? [])
    .filter((record) => productionBaseIdBySeedId.has(record.baseId))
    .map((record) => [record.id, `prod_${record.id}`]),
);

const remapTestIds = (value: unknown, ids: ReadonlyMap<string, string>): unknown => {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapTestIds(item, ids));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, remapTestIds(item, ids)]),
    );
  }
  return value;
};

const legacyCmsBaseIds = new Set([CMS_DEMO_POSTS_BASE_ID, CMS_DEMO_PAGES_BASE_ID]);
const taxonomyBaseIds = new Set([CMS_DEMO_CATEGORIES_BASE_ID, CMS_DEMO_TAGS_BASE_ID]);
const legacyProductionScenario: SeedScenario = {
  folders: [
    {
      nodeId: PRODUCTION_IDS.folder,
      slug: "cms",
      name: "CMS",
      description: "Existing production CMS content.",
      position: 2,
    },
    {
      nodeId: PRODUCTION_IDS.duplicateFolder,
      slug: "nextjs-fumadocs-demo-cms",
      name: "Next.js Fumadocs Demo CMS",
      description: "Temporary duplicate CMS folder.",
      position: 3,
    },
  ],
  bases: [
    ...(DEMO_BASES ?? []).filter((base) => legacyCmsBaseIds.has(base.id)),
    ...(scenario.bases ?? []).filter((base) => taxonomyBaseIds.has(base.id)),
  ].map((base) => {
    const productionBaseId = productionBaseIdBySeedId.get(base.id) ?? base.id;
    const productionNodeId = productionNodeIdBySeedId.get(base.nodeId) ?? base.nodeId;
    return {
      ...base,
      id: productionBaseId,
      nodeId: productionNodeId,
      folderNodeId: taxonomyBaseIds.has(base.id)
        ? PRODUCTION_IDS.duplicateFolder
        : PRODUCTION_IDS.folder,
      fields: base.fields.map((field) => ({
        ...field,
        options: remapTestIds(field.options, productionBaseIdBySeedId) as typeof field.options,
      })),
    };
  }),
  records: [
    ...(DEMO_RECORDS ?? []).filter((record) => legacyCmsBaseIds.has(record.baseId)),
    ...(scenario.records ?? []).filter((record) => taxonomyBaseIds.has(record.baseId)),
  ].map((record) => ({
    ...record,
    id: productionRecordIdBySeedId.get(record.id) ?? record.id,
    baseId: productionBaseIdBySeedId.get(record.baseId) ?? record.baseId,
    commitId: `prod_${record.commitId}`,
    fields: remapTestIds(record.fields, productionRecordIdBySeedId) as Record<string, unknown>,
  })),
};

describe("standard CMS conversion of the existing Busabase demo", () => {
  it("keeps one CMS Folder and maps the legacy Blog Posts and Pages Base IDs", () => {
    const cmsFolders = (scenario.folders ?? []).filter(
      (folder) => folder.slug === "cms" || folder.slug === "nextjs-fumadocs-demo-cms",
    );
    expect(cmsFolders).toHaveLength(1);
    expect(cmsFolders[0]).toMatchObject({ nodeId: CMS_DEMO_FOLDER_NODE_ID, slug: "cms" });
    expect(cmsFolders[0]?.metadata).toMatchObject({
      busabaseCms: { schemaVersion: 1, profile: "standard", bases: CMS_DEMO_BASE_IDS },
    });
    expect(CMS_DEMO_BASE_IDS.posts).toBe("bse_local_blog");
    expect(CMS_DEMO_BASE_IDS.pages).toBe("bse_local_seo_pages");
  });

  it("preserves 28 Blog Posts, 34 Pages, and Agent Integrations while adding taxonomy", () => {
    expect(recordsFor(CMS_DEMO_CATEGORIES_BASE_ID)).toHaveLength(4);
    expect(recordsFor(CMS_DEMO_TAGS_BASE_ID)).toHaveLength(6);
    expect(recordsFor(CMS_DEMO_POSTS_BASE_ID)).toHaveLength(28);
    expect(recordsFor(CMS_DEMO_PAGES_BASE_ID)).toHaveLength(34);
    expect(recordsFor(CMS_DEMO_AGENT_INTEGRATIONS_BASE_ID)).toHaveLength(6);

    expect(baseById.get(CMS_DEMO_CATEGORIES_BASE_ID)?.slug).toBe(
      "nextjs-fumadocs-demo-cms-categories",
    );
    expect(baseById.get(CMS_DEMO_TAGS_BASE_ID)?.slug).toBe("nextjs-fumadocs-demo-cms-tags");
    expect(baseById.get(CMS_DEMO_POSTS_BASE_ID)?.slug).toBe("blog");
    expect(baseById.get(CMS_DEMO_PAGES_BASE_ID)?.slug).toBe("pages");
    expect(baseById.get(CMS_DEMO_AGENT_INTEGRATIONS_BASE_ID)?.folderNodeId).toBe(
      DEMO_CONTENT_FOLDER_NODE_ID,
    );
  });

  it("is a pure, idempotent scenario conversion", () => {
    expect(withCmsDemoStandard(scenario)).toEqual(scenario);
  });

  it("matches every required standard field while retaining useful legacy fields", () => {
    for (const role of roles) {
      const base = baseById.get(CMS_DEMO_BASE_IDS[role]);
      expect(base, role).toBeDefined();
      const expected = getBusabaseCmsBaseDefinition(role, CMS_DEMO_BASE_IDS, "standard");
      for (const expectedField of expected.fields) {
        const actual = base?.fields.find((field) => field.slug === expectedField.slug);
        expect(actual, `${role}.${expectedField.slug}`).toMatchObject({
          slug: expectedField.slug,
          type: expectedField.type,
          required: expectedField.required,
          options: expectedField.options,
        });
      }
    }

    const posts = baseById.get(CMS_DEMO_POSTS_BASE_ID);
    expect(posts?.fields.some((field) => field.slug === "publish_date")).toBe(true);
    expect(posts?.fields.some((field) => field.slug === "related_social")).toBe(true);
    expect(posts?.fields.find((field) => field.slug === "legacy_tags")?.type).toBe("multiselect");
    const pages = baseById.get(CMS_DEMO_PAGES_BASE_ID);
    expect(pages?.fields.some((field) => field.slug === "html_body")).toBe(true);
    expect(pages?.fields.some((field) => field.slug === "page_score")).toBe(true);
  });

  it("maps legacy Post and Page fields without changing record identities", () => {
    const originalPost = DEMO_RECORDS.find((record) => record.id === "rec_seed_blog_approval");
    const post = recordsFor(CMS_DEMO_POSTS_BASE_ID).find(
      (record) => record.id === "rec_seed_blog_approval",
    );
    expect(post?.commitId).toBe(originalPost?.commitId);
    expect(post?.fields).toMatchObject({
      path: "/blog/ai-agents-are-moving-from-demos-into-operator-workflows",
      slug: "ai-agents-are-moving-from-demos-into-operator-workflows",
      locale: "en",
      status: "published",
      "published-at": "2026-06-10",
      "schema-version": 1,
      legacy_tags: ["agents", "policy"],
      tags: [CMS_DEMO_TAG_RECORD_IDS.workflowEn, CMS_DEMO_TAG_RECORD_IDS.openApiEn],
    });
    expect(String((post?.fields["cover-image"] as Array<{ url: string }>)[0]?.url)).toMatch(
      /^https:\/\/demo\.busabase\.com\/assets\//,
    );

    const drafting = recordsFor(CMS_DEMO_POSTS_BASE_ID).find(
      (record) => record.fields.status === "in-review",
    );
    const draft = recordsFor(CMS_DEMO_POSTS_BASE_ID).find(
      (record) => record.fields.status === "draft",
    );
    expect(drafting).toBeDefined();
    expect(draft).toBeDefined();

    const originalPage = DEMO_RECORDS.find((record) => record.id === "rec_seed_seo_vs_notion");
    const page = recordsFor(CMS_DEMO_PAGES_BASE_ID).find(
      (record) => record.id === "rec_seed_seo_vs_notion",
    );
    expect(page?.commitId).toBe(originalPage?.commitId);
    expect(page?.fields).toMatchObject({
      path: "/busabase-vs-notion",
      slug: "busabase-vs-notion",
      locale: "en",
      status: "published",
      template: "landing",
      body: originalPage?.fields.html_body,
      "seo-description": originalPage?.fields.meta_description,
      "schema-version": 1,
    });
  });

  it("produces records valid against the converged field definitions", () => {
    const failures = (scenario.records ?? []).flatMap((record) => {
      const base = baseById.get(record.baseId);
      if (!base) return [`Missing Base ${record.baseId}`];
      return validateRecordFields(
        record.fields,
        base.fields as unknown as ReadonlyArray<FieldDef>,
      ).map((error) => `${record.id}.${error.slug}: ${error.message}`);
    });
    expect(failures).toEqual([]);
  });

  describe("real PGLite seed", () => {
    let dataDir = "";
    let storageDir = "";
    let originalCwd = "";
    const client = createRouterClient(busabaseRouter);

    beforeAll(async () => {
      originalCwd = process.cwd();
      process.chdir(MIGRATIONS_CWD);
      dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-cms-converged-db-"));
      storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-cms-converged-storage-"));
      process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
      process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
      await seedScenario(legacyProductionScenario);
      await seedScenario(scenario);
    });

    afterAll(async () => {
      delete process.env.PG_DATABASE_URL;
      delete process.env.STORAGE_URL;
      process.chdir(originalCwd);
      await rm(dataDir, { recursive: true, force: true });
      await rm(storageDir, { recursive: true, force: true });
    });

    it("adopts production ids, moves taxonomy Bases, and remains idempotent", async () => {
      const folder = await client.folders.get({ nodeId: PRODUCTION_IDS.folder });
      expect(folder.node.metadata).toMatchObject({
        busabaseCms: {
          bases: PRODUCTION_IDS.bases,
          profile: "standard",
          schemaVersion: 1,
        },
      });
      expect(folder.children.map((child) => child.baseId).sort()).toEqual(
        Object.values(PRODUCTION_IDS.bases).sort(),
      );

      const marketingFolder = await client.folders.get({ nodeId: DEMO_CONTENT_FOLDER_NODE_ID });
      expect(marketingFolder.children.map((child) => child.baseId)).toContain(
        CMS_DEMO_AGENT_INTEGRATIONS_BASE_ID,
      );

      const duplicateFolder = await client.folders.get({ nodeId: PRODUCTION_IDS.duplicateFolder });
      expect(duplicateFolder.children).toHaveLength(0);

      const db = await getDb();
      const cmsRecords = await db
        .select({ id: busabaseRecords.id, baseId: busabaseRecords.baseId })
        .from(busabaseRecords)
        .where(inArray(busabaseRecords.baseId, Object.values(PRODUCTION_IDS.bases)));
      expect(
        cmsRecords.filter((record) => record.baseId === PRODUCTION_IDS.bases.posts),
      ).toHaveLength(28);
      expect(
        cmsRecords.filter((record) => record.baseId === PRODUCTION_IDS.bases.pages),
      ).toHaveLength(34);
      expect(
        cmsRecords.filter((record) => record.baseId === PRODUCTION_IDS.bases.categories),
      ).toHaveLength(4);
      expect(
        cmsRecords.filter((record) => record.baseId === PRODUCTION_IDS.bases.tags),
      ).toHaveLength(6);
      expect(cmsRecords.some((record) => record.id.startsWith("prod_rec_seed_blog"))).toBe(true);
      expect(cmsRecords.some((record) => record.id === "rec_seed_blog_approval")).toBe(false);

      const countsBefore = {
        folders: await db.select({ count: sql<number>`count(*)` }).from(busabaseNodes),
        bases: await db.select({ count: sql<number>`count(*)` }).from(busabaseBases),
        records: await db.select({ count: sql<number>`count(*)` }).from(busabaseRecords),
      };
      await seedScenario(scenario);
      const countsAfter = {
        folders: await db.select({ count: sql<number>`count(*)` }).from(busabaseNodes),
        bases: await db.select({ count: sql<number>`count(*)` }).from(busabaseBases),
        records: await db.select({ count: sql<number>`count(*)` }).from(busabaseRecords),
      };
      expect(countsAfter).toEqual(countsBefore);
    });
  });
});
