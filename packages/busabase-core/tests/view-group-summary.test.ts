import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import type { ViewConfigVO } from "busabase-contract/types";
import { applyInstall } from "busabase-package/apply";
import { collectPackageTree, findSourceNode } from "busabase-package/collect";
import { type PackageFiles, readPackageTree } from "busabase-package/layout-read";
import { writePackageTree } from "busabase-package/layout-write";
import { buildInstallPlan, resolveTargetState } from "busabase-package/plan";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import { normalizeViewConfig } from "../src/logic/vo";
import { busabaseRouter } from "../src/router";

/**
 * Column summaries and grouped grids promise numbers that match the rows the
 * grid shows. `filled` must agree with the `not_empty` view filter for every
 * field type, and `records.groupBy`'s `find` must agree with `records.listPage`'s
 * — both are cross-checked here against the endpoint the grid's rows come from.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const FILLED_FIELDS = [
  "notes",
  "stage",
  "tags",
  "amount",
  "won",
  "company",
  "company_name",
] as const;

describe("table summaries and grouping (real PGLite)", () => {
  let client: Client;
  let originalCwd = "";
  let dataDir = "";
  let storageDir = "";
  let companiesId = "";
  let dealsId = "";
  let folderNodeId = "";
  let acmeId = "";
  let filteredViewId = "";
  let umbrellaId = "";

  const merge = async (id: string) => {
    await client.changeRequests.review({ changeRequestIds: [id], verdict: "approved" });
    const {
      results: [result],
    } = await client.changeRequests.merge({ changeRequestIds: [id] });
    if (!result?.ok) throw new Error(result?.error ?? "Merge returned no result");
    return result;
  };
  const create = async (baseId: string, fields: Record<string, unknown>) => {
    const cr = await client.bases.createChangeRequest({ baseId, fields, autoMerge: false });
    const result = await merge(cr.id);
    if (!result.record) throw new Error("Expected created record");
    return result.record.id;
  };
  const listTotal = async (input: {
    filters?: Array<{ fieldSlug: string; operator: string; value?: unknown }>;
    viewId?: string;
    find?: { query: string; fieldId?: string };
  }) =>
    (
      await client.records.listPage({
        baseId: dealsId,
        pageSize: 25,
        ...input,
        filters: input.filters as never,
      })
    ).total;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "view-group-summary-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "view-group-summary-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    // One folder holds both Bases so the template export below is self-contained.
    const folder = await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        { kind: "create", nodeType: "folder", slug: "summary-folder", name: "Summary folder" },
      ],
    });
    folderNodeId = folder.mergeSummary.mergedNodeIds?.[0] ?? "";
    if (!folderNodeId) throw new Error("Expected a folder");
    const companies = await client.bases.create({
      slug: "summary-companies",
      name: "Companies",
      parentNodeId: folderNodeId,
      autoMerge: true,
      fields: [{ slug: "name", name: "Name", type: "text", required: false }],
    });
    companiesId = companies.id;
    const deals = await client.bases.create({
      slug: "summary-deals",
      name: "Deals",
      parentNodeId: folderNodeId,
      autoMerge: true,
      fields: [
        { slug: "title", name: "Title", type: "text", required: true },
        { slug: "notes", name: "Notes", type: "text" },
        {
          slug: "stage",
          name: "Stage",
          type: "select",
          options: {
            choices: [
              { id: "c_lead", name: "Lead" },
              { id: "c_won", name: "Won" },
            ],
          },
        },
        {
          slug: "tags",
          name: "Tags",
          type: "multiselect",
          options: {
            choices: [
              { id: "t_hot", name: "Hot" },
              { id: "t_cold", name: "Cold" },
            ],
          },
        },
        { slug: "amount", name: "Amount", type: "number" },
        { slug: "won", name: "Won", type: "checkbox" },
        { slug: "created", name: "Created", type: "created_time" },
        {
          slug: "company",
          name: "Company",
          type: "relation",
          options: { targetBaseSlug: companies.slug, multiple: true },
        },
        {
          slug: "company_name",
          name: "Company name",
          type: "lookup",
          options: {
            lookup: { relationFieldSlug: "company", targetFieldSlug: "name", rollup: "values" },
          },
        },
      ],
    });
    dealsId = deals.id;
    acmeId = await create(companiesId, { name: "Acme" });
    const globexId = await create(companiesId, { name: "Globex" });
    // Hand-picked so every field has both filled and empty rows, split unevenly
    // across the two stages and the no-stage bucket.
    await create(dealsId, {
      title: "Acme renewal",
      notes: "call back",
      stage: "c_lead",
      tags: ["t_hot"],
      amount: 100,
      won: true,
      company: [acmeId],
    });
    await create(dealsId, {
      title: "Acme upsell",
      stage: "c_lead",
      tags: [],
      amount: 0,
      company: [acmeId],
    });
    await create(dealsId, {
      title: "Globex pilot",
      notes: "",
      stage: "c_won",
      company: [globexId],
    });
    await create(dealsId, {
      title: "Initech",
      notes: "cold lead",
      tags: ["t_cold", "t_hot"],
      amount: 50,
      won: false,
    });
    umbrellaId = await create(dealsId, {
      title: "Umbrella",
      stage: "c_won",
      amount: 25,
      company: [],
    });
    const view = await client.views.changeRequest({
      operation: "create",
      baseId: dealsId,
      name: "Amount set",
      autoMerge: true,
      config: { filters: [{ fieldSlug: "amount", operator: "not_empty" }] },
    });
    if (!view.materialized) throw new Error("Expected a materialized view");
    filteredViewId = view.id;
  }, 120_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(originalCwd);
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });

  const expectFilledMatchesNotEmpty = async (viewId?: string) => {
    const whole = await client.records.groupBy({
      baseId: dealsId,
      ...(viewId ? { viewId } : {}),
      aggregates: FILLED_FIELDS.map((fieldSlug) => ({ fn: "filled" as const, fieldSlug })),
    });
    expect(whole.groups).toHaveLength(whole.total > 0 ? 1 : 0);
    for (const slug of FILLED_FIELDS) {
      const expected = await listTotal({
        viewId,
        filters: [{ fieldSlug: slug, operator: "not_empty" }],
      });
      expect({ slug, filled: whole.groups[0]?.aggregates?.[`filled:${slug}`] ?? 0 }).toEqual({
        slug,
        filled: expected,
      });
    }
    // The same agreement per group, which is what a grouped grid's header shows.
    const grouped = await client.records.groupBy({
      baseId: dealsId,
      fieldSlug: "stage",
      ...(viewId ? { viewId } : {}),
      aggregates: FILLED_FIELDS.map((fieldSlug) => ({ fn: "filled" as const, fieldSlug })),
    });
    for (const group of grouped.groups) {
      const stageFilter =
        group.value === null
          ? { fieldSlug: "stage", operator: "is_empty" }
          : { fieldSlug: "stage", operator: "equals", value: group.value };
      expect(await listTotal({ viewId, filters: [stageFilter] })).toBe(group.count);
      for (const slug of FILLED_FIELDS) {
        expect({ group: group.value, slug, filled: group.aggregates?.[`filled:${slug}`] }).toEqual({
          group: group.value,
          slug,
          filled: await listTotal({
            viewId,
            filters: [stageFilter, { fieldSlug: slug, operator: "not_empty" }],
          }),
        });
      }
    }
    return whole;
  };

  it("counts filled values exactly as the not_empty filter does, for every field type", async () => {
    const whole = await expectFilledMatchesNotEmpty();
    // Hand-counted guard so the cross-check cannot pass by both sides being 0.
    expect(whole.total).toBe(5);
    expect(whole.groups[0]?.aggregates).toMatchObject({
      "filled:notes": 2,
      "filled:stage": 4,
      "filled:tags": 2,
      "filled:amount": 4,
      "filled:company": 3,
      "filled:company_name": 3,
    });
  });

  it("agrees inside a filtered saved view too", async () => {
    const whole = await expectFilledMatchesNotEmpty(filteredViewId);
    expect(whole.total).toBe(4);
  });

  it("reads lookup values at request time, not their stale stored projection", async () => {
    // Blank the linked company's name: two deals' lookups become empty without
    // either deal record changing.
    const cleared = await client.records.changeRequest({
      operation: "update",
      recordId: acmeId,
      fields: { name: "" },
      autoMerge: false,
    });
    await merge(cleared.id);
    try {
      const whole = await expectFilledMatchesNotEmpty();
      expect(whole.groups[0]?.aggregates?.["filled:company_name"]).toBe(1);
    } finally {
      const restored = await client.records.changeRequest({
        operation: "update",
        recordId: acmeId,
        fields: { name: "Acme" },
        autoMerge: false,
      });
      await merge(restored.id);
    }
  });

  it("keeps the numeric aggregates next to filled, and count agrees with filled on numbers", async () => {
    const { groups } = await client.records.groupBy({
      baseId: dealsId,
      aggregates: [
        { fn: "sum", fieldSlug: "amount" },
        { fn: "avg", fieldSlug: "amount" },
        { fn: "min", fieldSlug: "amount" },
        { fn: "max", fieldSlug: "amount" },
        { fn: "count", fieldSlug: "amount" },
        { fn: "filled", fieldSlug: "amount" },
      ],
    });
    expect(groups[0]?.aggregates).toEqual({
      "sum:amount": 175,
      "avg:amount": 43.75,
      "min:amount": 0,
      "max:amount": 100,
      "count:amount": 4,
      "filled:amount": 4,
    });
  });

  it("counts checked boxes exactly as the is_true filter does, unset boxes included", async () => {
    // One checked box per stage that has records, plus an explicit false and
    // two never-set boxes, which must count as unchecked.
    const checkUmbrella = await client.records.changeRequest({
      operation: "update",
      recordId: umbrellaId,
      fields: { won: true },
      autoMerge: false,
    });
    await merge(checkUmbrella.id);
    const isTrue = { fieldSlug: "won", operator: "is_true" };
    const isFalse = { fieldSlug: "won", operator: "is_false" };
    const aggregates = [{ fn: "checked" as const, fieldSlug: "won" }];
    for (const viewId of [undefined, filteredViewId]) {
      const scope = viewId ? { viewId } : {};
      const whole = await client.records.groupBy({ baseId: dealsId, ...scope, aggregates });
      const checked = whole.groups[0]?.aggregates?.["checked:won"] ?? 0;
      expect({ viewId, checked }).toEqual({
        viewId,
        checked: await listTotal({ viewId, filters: [isTrue] }),
      });
      // unchecked = count - checked, which is exactly what is_false keeps.
      expect(whole.total - checked).toBe(await listTotal({ viewId, filters: [isFalse] }));
      const grouped = await client.records.groupBy({
        baseId: dealsId,
        fieldSlug: "stage",
        ...scope,
        aggregates,
      });
      for (const group of grouped.groups) {
        const stageFilter =
          group.value === null
            ? { fieldSlug: "stage", operator: "is_empty" }
            : { fieldSlug: "stage", operator: "equals", value: group.value };
        const groupChecked = group.aggregates?.["checked:won"];
        expect({ group: group.value, viewId, checked: groupChecked }).toEqual({
          group: group.value,
          viewId,
          checked: await listTotal({ viewId, filters: [stageFilter, isTrue] }),
        });
        expect(group.count - (groupChecked ?? 0)).toBe(
          await listTotal({ viewId, filters: [stageFilter, isFalse] }),
        );
      }
    }
    // Hand-counted guard: 2 checked, 1 explicit false, 2 never set.
    const whole = await client.records.groupBy({ baseId: dealsId, aggregates });
    expect(whole.groups[0]?.aggregates?.["checked:won"]).toBe(2);
    expect(whole.total).toBe(5);
  });

  it("refuses checked on anything but a checkbox", async () => {
    for (const fieldSlug of ["notes", "stage", "amount"]) {
      await expect(
        client.records.groupBy({ baseId: dealsId, aggregates: [{ fn: "checked", fieldSlug }] }),
      ).rejects.toThrow(/needs a checkbox field/);
    }
  });

  it("refuses numeric aggregates on non-number fields but takes filled anywhere", async () => {
    await expect(
      client.records.groupBy({ baseId: dealsId, aggregates: [{ fn: "sum", fieldSlug: "notes" }] }),
    ).rejects.toThrow(/Cannot sum a text field/);
    await expect(
      client.records.groupBy({
        baseId: dealsId,
        aggregates: [{ fn: "filled", fieldSlug: "nope" }],
      }),
    ).rejects.toThrow(/Field not found/);
  });

  it("applies find with records.listPage's semantics, per group and in a view", async () => {
    const titleFieldId = (await client.bases.get({ baseId: dealsId })).fields.find(
      (field) => field.slug === "title",
    )?.id;
    for (const find of [
      { query: "acme" },
      { query: "COLD" },
      { query: "hot" },
      { query: "acme", fieldId: titleFieldId },
      { query: "nothing matches this" },
    ]) {
      for (const viewId of [undefined, filteredViewId]) {
        const whole = await client.records.groupBy({
          baseId: dealsId,
          find,
          ...(viewId ? { viewId } : {}),
        });
        expect({ find, viewId, total: whole.total }).toEqual({
          find,
          viewId,
          total: await listTotal({ find, viewId }),
        });
        const grouped = await client.records.groupBy({
          baseId: dealsId,
          fieldSlug: "stage",
          find,
          ...(viewId ? { viewId } : {}),
          aggregates: [{ fn: "filled", fieldSlug: "notes" }],
        });
        for (const group of grouped.groups) {
          const stageFilter =
            group.value === null
              ? { fieldSlug: "stage", operator: "is_empty" }
              : { fieldSlug: "stage", operator: "equals", value: group.value };
          expect(await listTotal({ find, viewId, filters: [stageFilter] })).toBe(group.count);
        }
        expect(grouped.total).toBe(whole.total);
      }
    }
    // Guard: the searches above are not all empty.
    expect((await client.records.groupBy({ baseId: dealsId, find: { query: "acme" } })).total).toBe(
      2,
    );
  });

  // `records.listPage` searches only the fields a View shows unless one is
  // chosen. A count that searched hidden fields too would include rows the
  // grid leaves out, so a footer would disagree with the table under it.
  it("scopes find to the fields the view shows, exactly as records.listPage does", async () => {
    const hidden = await client.views.changeRequest({
      operation: "create",
      baseId: dealsId,
      name: "Notes hidden",
      autoMerge: true,
      config: { filters: [], sorts: [], hiddenFieldSlugs: ["notes"] },
    });
    if (!hidden.materialized) throw new Error("Expected a materialized view");
    const notesFieldId = (await client.bases.get({ baseId: dealsId })).fields.find(
      (field) => field.slug === "notes",
    )?.id;
    // "call back" appears only in the Notes of one deal.
    for (const find of [{ query: "call back" }, { query: "call back", fieldId: notesFieldId }]) {
      for (const viewId of [undefined, hidden.id]) {
        const grouped = await client.records.groupBy({
          baseId: dealsId,
          fieldSlug: "stage",
          find,
          ...(viewId ? { viewId } : {}),
          aggregates: [{ fn: "filled", fieldSlug: "notes" }],
        });
        expect({ find, viewId, total: grouped.total }).toEqual({
          find,
          viewId,
          total: await listTotal({ find, viewId }),
        });
      }
    }
    // Guards: the hidden column hides the match by default; choosing the field finds it.
    expect(
      (await client.records.groupBy({ baseId: dealsId, find: { query: "call back" } })).total,
    ).toBe(1);
    expect(
      (
        await client.records.groupBy({
          baseId: dealsId,
          viewId: hidden.id,
          find: { query: "call back" },
        })
      ).total,
    ).toBe(0);
    expect(
      (
        await client.records.groupBy({
          baseId: dealsId,
          viewId: hidden.id,
          find: { query: "call back", fieldId: notesFieldId },
        })
      ).total,
    ).toBe(1);
  });

  it("validates grouping and summaries on write and round-trips them", async () => {
    const created = await client.views.changeRequest({
      operation: "create",
      baseId: dealsId,
      name: "Grouped",
      autoMerge: true,
      config: {
        groupBy: [{ fieldSlug: "stage", direction: "desc" }],
        fieldSummaries: { amount: "sum", notes: "percent_filled", title: "filled" },
      },
    });
    if (!created.materialized) throw new Error("Expected a materialized view");
    const readView = async () => {
      const view = (await client.bases.listViews({ baseId: dealsId })).find(
        (item) => item.id === created.id,
      );
      if (!view) throw new Error("Missing grouped view");
      return view;
    };
    expect((await readView()).config).toMatchObject({
      groupBy: [{ fieldSlug: "stage", direction: "desc" }],
      fieldSummaries: { amount: "sum", notes: "percent_filled", title: "filled" },
    });

    const update = (config: ViewConfigVO | Record<string, unknown>) =>
      client.views.changeRequest({
        operation: "update",
        viewId: created.id,
        config: config as never,
        autoMerge: true,
      });
    await expect(update({ groupBy: [{ fieldSlug: "notes" }] })).rejects.toThrow(
      /Cannot group by a text field/,
    );
    await expect(update({ groupBy: [{ fieldSlug: "missing" }] })).rejects.toThrow(/no such field/);
    await expect(update({ fieldSummaries: { notes: "sum" } })).rejects.toThrow(
      /Cannot summarize a text field with sum/,
    );
    await expect(update({ fieldSummaries: { missing: "avg" } })).rejects.toThrow(/no such field/);
    // A checkbox takes only the checked family, and only a checkbox takes it.
    await expect(update({ fieldSummaries: { won: "percent_filled" } })).rejects.toThrow(
      /Cannot summarize a checkbox field with percent_filled/,
    );
    await expect(update({ fieldSummaries: { notes: "checked" } })).rejects.toThrow(
      /Cannot summarize a text field with checked/,
    );
    await expect(update({ fieldSummaries: { missing: "unchecked" } })).rejects.toThrow(
      /no such field/,
    );
    // Always-set system fields get no filled family.
    await expect(update({ fieldSummaries: { created: "filled" } })).rejects.toThrow(
      /Cannot summarize a created_time field with filled/,
    );
    await update({ fieldSummaries: { won: "percent_checked", amount: "sum" } });
    expect((await readView()).config.fieldSummaries).toEqual({
      won: "percent_checked",
      amount: "sum",
    });
    await expect(
      update({ groupBy: [{ fieldSlug: "stage" }, { fieldSlug: "won" }] }),
    ).rejects.toThrow();

    await update({ groupBy: [{ fieldSlug: "won", direction: "asc" }] });
    expect((await readView()).config.groupBy).toEqual([{ fieldSlug: "won", direction: "asc" }]);
    // A universal summary may name a field that does not exist yet (templates
    // create views before relation/lookup fields); readers ignore it until then.
    await update({ fieldSummaries: { amount: "avg", later_field: "empty" } });
    expect((await readView()).config.fieldSummaries).toEqual({
      amount: "avg",
      later_field: "empty",
    });

    // Delete the grouped field: the stale setting must not block unrelated edits.
    const wonFieldId = (await client.bases.get({ baseId: dealsId })).fields.find(
      (field) => field.slug === "won",
    )?.id;
    await client.bases.fieldChangeRequest({
      operation: "delete",
      baseId: dealsId,
      fieldId: wonFieldId as string,
      autoMerge: true,
    } as never);
    await update({ rowHeight: "tall" });
    expect((await readView()).config).toMatchObject({
      rowHeight: "tall",
      groupBy: [{ fieldSlug: "won", direction: "asc" }],
    });
    await update({ groupBy: [] });
    expect((await readView()).config.groupBy).toBeUndefined();
  });

  it("tolerates malformed stored settings", () => {
    const normalized = normalizeViewConfig({
      filters: [],
      sorts: [],
      groupBy: [
        { fieldSlug: "stage", direction: "sideways" },
        { fieldSlug: "" },
        "status",
        { fieldSlug: "won", direction: "desc" },
      ],
      fieldSummaries: { amount: "median", notes: "filled", "": "sum", title: 3 },
    } as unknown as ViewConfigVO);
    expect(normalized.groupBy).toEqual([{ fieldSlug: "stage", direction: "asc" }]);
    expect(normalized.fieldSummaries).toEqual({ notes: "filled" });
    expect(normalizeViewConfig({ filters: [], sorts: [] }).groupBy).toBeUndefined();
    expect(
      normalizeViewConfig({ filters: [], sorts: [], fieldSummaries: [] } as never).fieldSummaries,
    ).toBeUndefined();
  });

  it("carries grouping and summaries through a real template export and install", async () => {
    const view = await client.views.changeRequest({
      operation: "create",
      baseId: dealsId,
      slug: "template-grouped",
      name: "Template grouped",
      autoMerge: true,
      config: {
        groupBy: [{ fieldSlug: "stage", direction: "desc" }],
        fieldSummaries: { amount: "max", company_name: "filled", stage: "empty" },
      },
    });
    if (!view.materialized) throw new Error("Expected a materialized view");
    const directory = await mkdtemp(path.join(os.tmpdir(), "busabase-group-summary-package-"));
    try {
      const root = findSourceNode(await client.nodes.list({}), folderNodeId);
      const tree = await collectPackageTree(client, root, {
        manifest: {
          format: PACKAGE_FORMAT,
          name: "group-summary-package",
          description: "Grouping and summaries acceptance",
          tags: [],
        },
        baseUrl: "http://localhost:15419",
        warn: () => {},
      });
      await writePackageTree(tree, directory);
      const files: PackageFiles = new Map();
      const walk = async (relative: string): Promise<void> => {
        for (const entry of await readdir(path.join(directory, relative), {
          withFileTypes: true,
        })) {
          const name = path.join(relative, entry.name);
          if (entry.isDirectory()) await walk(name);
          else files.set(name, await readFile(path.join(directory, name)));
        }
      };
      await walk("");
      const viewFile = [...files.entries()].find(([name, content]) =>
        name.endsWith(".json") ? content.toString("utf8").includes('"template-grouped"') : false,
      );
      expect(viewFile?.[1].toString("utf8")).toContain('"fieldSummaries"');
      const parsed = readPackageTree(files);
      const db = await getDb();
      await runWithBusabaseContext({ db, spaceId: "group_summary_package_target" }, async () => {
        const state = await resolveTargetState(client, parsed.manifest.name);
        const plan = buildInstallPlan(parsed, state);
        expect(plan.collisions).toEqual([]);
        await applyInstall(client, plan, { autoMerge: true });
        const installed = (await client.bases.list({})).find(
          (item) => item.slug === "summary-deals",
        );
        if (!installed) throw new Error("Missing installed Deals Base");
        const views = await client.bases.listViews({ baseId: installed.id });
        expect(views.find((item) => item.slug === "template-grouped")?.config).toMatchObject({
          groupBy: [{ fieldSlug: "stage", direction: "desc" }],
          fieldSummaries: { amount: "max", company_name: "filled", stage: "empty" },
        });
        // The installed grouping is live, not just stored: it groups the copy.
        await expect(
          client.records.groupBy({ baseId: installed.id, fieldSlug: "stage" }),
        ).resolves.toMatchObject({ total: expect.any(Number) });
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
