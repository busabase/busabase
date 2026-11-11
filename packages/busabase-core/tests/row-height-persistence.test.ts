import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import {
  GRID_ROW_HEIGHT_PRESETS,
  GRID_ROW_HEIGHTS,
  getGridRowHeight,
  type ViewConfigVO,
} from "busabase-contract/types";
import { applyInstall } from "busabase-package/apply";
import { collectPackageTree, findSourceNode } from "busabase-package/collect";
import { type PackageFiles, readPackageTree } from "busabase-package/layout-read";
import { writePackageTree } from "busabase-package/layout-write";
import { buildInstallPlan, resolveTargetState } from "busabase-package/plan";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { busabaseViews } from "../src/db/schema";
import { normalizeViewConfig } from "../src/logic/vo";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

describe("row height normalization", () => {
  it("preserves supported presets and the omitted legacy default", () => {
    expect(normalizeViewConfig({}).rowHeight).toBeUndefined();
    expect(getGridRowHeight(normalizeViewConfig({}).rowHeight)).toBe(48);
    for (const rowHeight of GRID_ROW_HEIGHT_PRESETS) {
      expect(normalizeViewConfig({ rowHeight }).rowHeight).toBe(rowHeight);
    }
  });

  it.each(["auto", null, 90, "__proto__", "constructor"])(
    "recovers safely from malformed stored settings %j",
    (rowHeight) => {
      const normalized = normalizeViewConfig({ rowHeight } as unknown as ViewConfigVO);
      expect(normalized.rowHeight).toBeUndefined();
      expect(getGridRowHeight(normalized.rowHeight)).toBe(48);
    },
  );
});

it("persists view-local density through reviewed patches and a real portable package install", async () => {
  const { db } = await seedScenario("row-height-persistence");
  const client = createRouterClient(busabaseRouter);
  const base = await client.bases.create({
    slug: "density-probe",
    name: "Density probe",
    autoMerge: true,
    fields: [{ slug: "title", name: "Title", type: "text", required: true }],
  });
  if (!base.materialized) throw new Error("Expected the source Base to materialize");
  const [legacy] = await client.bases.listViews({ baseId: base.id });
  expect(legacy.config.rowHeight).toBeUndefined();
  expect(getGridRowHeight(legacy.config.rowHeight)).toBe(48);

  const created = await client.views.changeRequest({
    operation: "create",
    baseId: base.id,
    slug: "density",
    name: "Density",
    autoMerge: true,
    config: {
      rowHeight: "short",
      fieldWidths: { title: 260 },
      filters: [{ fieldSlug: "title", operator: "contains", value: "Review" }],
      sorts: [{ fieldSlug: "title", direction: "asc" }],
    },
  });
  if (!created.materialized) throw new Error("Expected a materialized view");
  const readView = async () => {
    const view = (await client.bases.listViews({ baseId: base.id })).find(
      (item) => item.id === created.id,
    );
    if (!view) throw new Error("Missing density view");
    return view;
  };
  const initial = await readView();
  for (const rowHeight of GRID_ROW_HEIGHT_PRESETS) {
    await client.views.changeRequest({
      operation: "update",
      viewId: created.id,
      config: { rowHeight },
      autoMerge: true,
    });
    const view = await readView();
    expect(view.config).toEqual({ ...initial.config, rowHeight });
    expect(getGridRowHeight(view.config.rowHeight)).toBe(GRID_ROW_HEIGHTS[rowHeight]);
    const [stored] = await db
      .select({ config: busabaseViews.config })
      .from(busabaseViews)
      .where(eq(busabaseViews.id, created.id));
    expect(stored.config).toMatchObject({ rowHeight });
  }

  const pending = await client.views.changeRequest({
    operation: "update",
    viewId: created.id,
    config: { rowHeight: "short" },
    autoMerge: false,
  });
  expect(pending.materialized).toBe(false);
  expect((await readView()).config.rowHeight).toBe("extra-tall");
  await client.views.changeRequest({
    operation: "update",
    viewId: created.id,
    name: "Renamed density",
    config: { fieldWidths: { title: 320 } },
    autoMerge: true,
  });
  expect((await readView()).config.rowHeight).toBe("extra-tall");
  await client.changeRequests.review({
    changeRequestIds: [pending.id],
    verdict: "approved",
  });
  const merged = await client.changeRequests.merge({ changeRequestIds: [pending.id] });
  expect(merged.results[0]?.ok).toBe(true);
  expect(await readView()).toMatchObject({
    name: "Renamed density",
    config: { rowHeight: "short", fieldWidths: { title: 320 } },
  });
  expect(
    (await client.bases.listViews({ baseId: base.id })).find((view) => view.id === legacy.id)
      ?.config.rowHeight,
  ).toBeUndefined();

  // Each preset travels through collection, actual files, Zod reading, planning,
  // and server-side install. Testing only a schema would miss explicit pickers.
  for (const rowHeight of GRID_ROW_HEIGHT_PRESETS) {
    await client.views.changeRequest({
      operation: "create",
      baseId: base.id,
      name: `${rowHeight} package view`,
      slug: `package-${rowHeight}`,
      config: { rowHeight, fieldWidths: { title: 200 } },
      autoMerge: true,
    });
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "busabase-density-package-"));
  try {
    const root = findSourceNode(await client.nodes.list({}), base.nodeId);
    const tree = await collectPackageTree(client, root, {
      manifest: {
        format: PACKAGE_FORMAT,
        name: "density-package",
        description: "Saved row-height acceptance",
        tags: [],
      },
      baseUrl: "http://localhost:15419",
      warn: (message) => {
        throw new Error(message);
      },
    });
    await writePackageTree(tree, directory);
    const files: PackageFiles = new Map();
    const walk = async (relative: string): Promise<void> => {
      for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
        const name = path.join(relative, entry.name);
        if (entry.isDirectory()) await walk(name);
        else files.set(name, await readFile(path.join(directory, name)));
      }
    };
    await walk("");
    const parsed = readPackageTree(files);
    await runWithBusabaseContext({ db, spaceId: "density_package_target" }, async () => {
      const state = await resolveTargetState(client, parsed.manifest.name);
      const plan = buildInstallPlan(parsed, state);
      expect(plan.collisions).toEqual([]);
      await applyInstall(client, plan, { autoMerge: true });
      const installed = (await client.bases.list({})).find((item) => item.slug === base.slug);
      if (!installed) throw new Error("Missing installed density Base");
      const views = await client.bases.listViews({ baseId: installed.id });
      expect(views.find((view) => view.slug === legacy.slug)?.config.rowHeight).toBeUndefined();
      for (const rowHeight of GRID_ROW_HEIGHT_PRESETS) {
        expect(views.find((view) => view.slug === `package-${rowHeight}`)?.config).toMatchObject({
          rowHeight,
          fieldWidths: { title: 200 },
        });
      }
      expect(views.find((view) => view.slug === "density")).toMatchObject({
        name: "Renamed density",
        config: { rowHeight: "short", fieldWidths: { title: 320 } },
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
