import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import { applyInstall } from "busabase-package/apply";
import type { PackageClient } from "busabase-package/client";
import { buildInstallPlan, resolveTargetState } from "busabase-package/plan";
import type { PackageTree } from "busabase-package/tree";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import { busabaseBases, busabaseViews } from "../src/db/schema";
import type { SeedScenario } from "../src/demo/seed-types";
import { rootNodeIdForSpace } from "../src/logic/kernel";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Every way a Base comes into existence leaves it with at least one active
 * view — a Base opens on its leftmost view and the dashboard no longer has an
 * unsaved "All" tab to fall back on. Authored views (seed scenarios, packages)
 * are kept exactly, in the author's order, with no extra Grid view; only a
 * Base that ships none gets the default one.
 *
 * Creation paths covered here: bases.create (direct + review-first),
 * nodes.createChangeRequest, the seed, package install, and a dump restore.
 * The last test walks every Base in the database.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const viewsOf = async (client: Client, baseId: string) =>
  (await client.bases.listViews({ baseId })).map((view) => [view.name, view.position]);

const seedTestScenario = (): SeedScenario => ({
  folders: [
    {
      nodeId: "nod_seed_views",
      slug: "seed-views",
      name: "Seed views",
      description: "",
      position: 0,
    },
  ],
  bases: [
    {
      id: "bse_seed_plain",
      nodeId: "nod_seed_plain",
      slug: "seed-plain",
      name: "Seed plain",
      description: "",
      folderNodeId: "nod_seed_views",
      useCases: ["1"],
      fields: [
        {
          id: "bsf_seed_plain_title",
          slug: "title",
          name: "Title",
          type: "text",
          required: true,
          options: {},
        },
      ],
    },
    {
      id: "bse_seed_authored",
      nodeId: "nod_seed_authored",
      slug: "seed-authored",
      name: "Seed authored",
      description: "",
      folderNodeId: "nod_seed_views",
      useCases: ["1"],
      fields: [
        {
          id: "bsf_seed_authored_title",
          slug: "title",
          name: "Title",
          type: "text",
          required: true,
          options: {},
        },
        {
          id: "bsf_seed_authored_status",
          slug: "status",
          name: "Status",
          type: "select",
          required: false,
          options: {},
        },
      ],
    },
  ],
  views: [
    // Listed first but created LATER: the listing order, not creation time,
    // decides which view the Base opens on.
    {
      id: "viw_seed_authored_board",
      baseId: "bse_seed_authored",
      slug: "board",
      name: "Board",
      description: "",
      type: "kanban",
      config: { filters: [], sorts: [], stackByFieldSlug: "status" },
      minutesAgo: 1,
      useCases: ["1"],
    },
    {
      id: "viw_seed_authored_open",
      baseId: "bse_seed_authored",
      slug: "open",
      name: "Open",
      description: "",
      config: { filters: [{ fieldSlug: "status", operator: "equals", value: "open" }], sorts: [] },
      minutesAgo: 10,
      useCases: ["1"],
    },
  ],
});

const packageTree = (name: string): PackageTree => ({
  manifest: { format: PACKAGE_FORMAT, name, description: "View order probe", tags: [] },
  nodes: [
    {
      type: "base",
      slug: "pkg-authored",
      name: "Package authored",
      description: "",
      position: 0,
      base: {
        name: "Package authored",
        description: "",
        fields: [
          { slug: "title", name: "Title", type: "text", required: true, position: 0, options: {} },
          { slug: "stage", name: "Stage", type: "text", required: false, position: 1, options: {} },
        ],
        views: [
          {
            slug: "pipeline",
            name: "Pipeline",
            description: "",
            type: "table",
            config: { filters: [], sorts: [{ direction: "asc", fieldSlug: "stage" }] },
          },
          {
            slug: "won",
            name: "Won",
            description: "",
            type: "table",
            config: {
              filters: [{ fieldSlug: "stage", operator: "equals", value: "won" }],
              sorts: [],
            },
          },
        ],
      },
      records: [],
    },
    {
      type: "base",
      slug: "pkg-plain",
      name: "Package plain",
      description: "",
      position: 1,
      base: {
        name: "Package plain",
        description: "",
        fields: [
          { slug: "title", name: "Title", type: "text", required: true, position: 0, options: {} },
        ],
        views: [],
      },
      records: [],
    },
  ],
});

describe("every Base creation path leaves the Base with a view", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  const inSpace = <T>(spaceId: string, fn: () => Promise<T>): Promise<T> =>
    runWithBusabaseContext({ spaceId }, fn);

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-view-entry-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-view-entry-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("bases.create and nodes.createChangeRequest (direct and review-first)", async () => {
    await inSpace("space_views_api", async () => {
      const direct = await client.bases.create({ autoMerge: true, slug: "direct", name: "Direct" });
      if (!direct.materialized) throw new Error("expected a materialized Base");
      expect(await viewsOf(client, direct.id)).toEqual([["Grid view", 0]]);

      const proposed = await client.bases.create({ autoMerge: false, slug: "proposed", name: "P" });
      const tree = await client.nodes.createChangeRequest({
        autoMerge: false,
        operations: [{ kind: "create", nodeType: "base", slug: "tree", name: "Tree" }],
      });
      if (proposed.materialized) throw new Error("expected a pending change request");
      await client.changeRequests.review({
        changeRequestIds: [proposed.id, tree.id],
        verdict: "approved",
      });
      const merged = await client.changeRequests.merge({
        changeRequestIds: [proposed.id, tree.id],
      });
      expect(merged.results.every((result) => result.ok)).toBe(true);
      for (const slug of ["proposed", "tree"]) {
        const base = await client.bases.get({ baseId: slug });
        expect(await viewsOf(client, base.id)).toEqual([["Grid view", 0]]);
      }
    });
  });

  it("seed: authored views exactly, in listed order; a Base without any gets Grid view", async () => {
    await seedScenario(seedTestScenario());
    expect(await viewsOf(client, "bse_seed_plain")).toEqual([["Grid view", 0]]);
    expect(await viewsOf(client, "bse_seed_authored")).toEqual([
      ["Board", 0],
      ["Open", 1],
    ]);

    // Re-seeding adds nothing and keeps the workspace's own order.
    const [open] = (await client.bases.listViews({ baseId: "bse_seed_authored" })).filter(
      (view) => view.slug === "open",
    );
    await client.views.changeRequest({
      operation: "update",
      viewId: open.id,
      position: 0,
      autoMerge: true,
    });
    await seedScenario(seedTestScenario());
    expect(await viewsOf(client, "bse_seed_plain")).toEqual([["Grid view", 0]]);
    expect(await viewsOf(client, "bse_seed_authored")).toEqual([
      ["Open", 0],
      ["Board", 1],
    ]);
  });

  it("seed: a localized scenario names the default view in its own language", async () => {
    await seedScenario({
      ...seedTestScenario(),
      defaultViewName: "表格视图",
      bases: [
        {
          ...(seedTestScenario().bases ?? [])[0],
          id: "bse_seed_zh",
          nodeId: "nod_seed_zh",
          slug: "seed-zh",
          fields: [
            {
              id: "bsf_seed_zh_title",
              slug: "title",
              name: "标题",
              type: "text",
              required: true,
              options: {},
            },
          ],
        },
      ],
      views: [],
    });
    expect(await viewsOf(client, "bse_seed_zh")).toEqual([["表格视图", 0]]);
  });

  it("package install: the package's views in its order, or Grid view when it ships none", async () => {
    const spaceId = "space_views_package";
    const packageClient: PackageClient = client;
    await inSpace(spaceId, async () => {
      const tree = packageTree("view-order-probe");
      const plan = buildInstallPlan(
        tree,
        await resolveTargetState(packageClient, tree.manifest.name),
      );
      const result = await applyInstall(packageClient, plan, { autoMerge: true });
      expect(result.created.views).toBe(2);
      const bases = await client.bases.list({});
      const authored = bases.find((base) => base.name === "Package authored");
      const plain = bases.find((base) => base.name === "Package plain");
      if (!authored || !plain) throw new Error("expected both package Bases");
      expect(await viewsOf(client, authored.id)).toEqual([
        ["Pipeline", 0],
        ["Won", 1],
      ]);
      expect(await viewsOf(client, plain.id)).toEqual([["Grid view", 0]]);
    });
  });

  it("dump restore: renumbers pre-position views and gives a view-less Base its Grid view", async () => {
    const targetSpace = "space_views_restore";
    const rootId = rootNodeIdForSpace(targetSpace);
    const at = (iso: string) => new Date(iso).toISOString();
    await inSpace(targetSpace, async () => {
      const { sessionId } = await client.dump.importBegin({ sourceSpaceId: targetSpace });
      await client.dump.importTables({
        sessionId,
        table: "nodes",
        rows: ["legacy-views", "legacy-empty"].map((slug, index) => ({
          id: `nod_restore_${index}`,
          spaceId: targetSpace,
          parentId: rootId,
          type: "base",
          slug,
          name: slug,
          description: "",
          metadata: {},
          position: index,
          archivedAt: null,
          deletedAt: null,
          createdAt: at("2026-01-01"),
          updatedAt: at("2026-01-01"),
        })),
      });
      await client.dump.importTables({
        sessionId,
        table: "bases",
        rows: ["legacy-views", "legacy-empty"].map((slug, index) => ({
          id: `bse_restore_${index}`,
          spaceId: targetSpace,
          nodeId: `nod_restore_${index}`,
          slug,
          name: slug,
          description: "",
          reviewPolicy: { kind: "single", requiredApprovals: 1 },
          createdAt: at("2026-01-01"),
          archivedAt: null,
          deletedAt: null,
        })),
      });
      // An archive from before views had a position: the column is absent.
      await client.dump.importTables({
        sessionId,
        table: "views",
        rows: [
          ["viw_restore_late", "late", "2026-01-03"],
          ["viw_restore_early", "early", "2026-01-02"],
        ].map(([id, slug, createdAt]) => ({
          id,
          spaceId: targetSpace,
          baseId: "bse_restore_0",
          slug,
          name: slug,
          description: "",
          type: "table",
          config: { filters: [], sorts: [] },
          status: "active",
          createdBy: "u",
          archivedAt: null,
          createdAt: at(createdAt),
          updatedAt: at(createdAt),
        })),
      });
      await client.dump.importCommit({ sessionId });

      expect(await viewsOf(client, "bse_restore_0")).toEqual([
        ["early", 0],
        ["late", 1],
      ]);
      expect(await viewsOf(client, "bse_restore_1")).toEqual([["Grid view", 0]]);
    });
  });

  it("leaves no live Base in the database without an active view", async () => {
    const db = await getDb();
    const bases = await db
      .select({ id: busabaseBases.id, slug: busabaseBases.slug })
      .from(busabaseBases)
      .where(and(isNull(busabaseBases.archivedAt), isNull(busabaseBases.deletedAt)));
    expect(bases.length).toBeGreaterThanOrEqual(10);
    const activeViews = await db
      .select({ baseId: busabaseViews.baseId })
      .from(busabaseViews)
      .where(eq(busabaseViews.status, "active"));
    const withViews = new Set(activeViews.map((view) => view.baseId));
    expect(bases.filter((base) => !withViews.has(base.id))).toEqual([]);
  });
});
