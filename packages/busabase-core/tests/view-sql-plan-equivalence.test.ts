import { createRouterClient } from "@orpc/server";
import type {
  BaseFieldVO,
  ViewFilterConditionVO,
  ViewFilterVO,
  ViewSortVO,
} from "busabase-contract/types";
import { combineViewFilters } from "busabase-contract/types";
import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseCommits, busabaseFieldValues, busabaseRecords } from "../src/db/schema";
import { planViewSql } from "../src/domains/base/logic/view-sql-plan";
import {
  applyViewConfigToEvaluableRecords,
  groupKeyForValue,
} from "../src/domains/base/utils/view-records";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

/**
 * Saved-view filters, sorts, counts and groups decided in SQL (`planViewSql`)
 * must give EXACTLY what the in-process view matcher and comparator give over
 * the whole Base. The reference here is that matcher and comparator applied to
 * every active record's raw head-commit payload — what `listRecordsPage`,
 * `countRecords` and `groupRecords` computed before anything was pushed down.
 *
 * The data is built to hit the places where SQL and JavaScript disagree:
 * case and accents (`toLowerCase` vs ILIKE, `sensitivity: "base"`), CJK and
 * emoji, numeric collation ("item 2" < "item 10", "-3" vs "-10", "1.5" vs
 * "1.25"), select labels that differ only by case, a "-" label, missing
 * values, ties, a date in a zone, texts past the projection limit, a field slug
 * reused after a delete, archived records, pending change requests, two
 * updatedAt values in the same millisecond, an id that `localeCompare` orders
 * differently from code points, and a member who is not a space manager.
 */
describe("view filters/sorts/counts/groups — SQL path equals the in-process path", () => {
  it("returns identical ids, order, totals, counts and buckets", { timeout: 600_000 }, async () => {
    const { db } = await seedScenario("view-sql-plan-equivalence");
    const client = createRouterClient(busabaseRouter);

    const STATUS = [
      { id: "c_done", name: "Done" },
      { id: "c_done_lower", name: "done" },
      { id: "c_todo", name: "待办" },
      { id: "c_dash", name: "-" },
      { id: "c_item10", name: "Item 10" },
      { id: "c_item2", name: "Item 2" },
      { id: "c_elan", name: "Élan" },
    ];
    const base = await client.bases.create({
      autoMerge: true,
      slug: "equivalence",
      name: "Equivalence",
      fields: [
        { slug: "title", name: "Title", type: "text" },
        { slug: "body", name: "Body", type: "longtext" },
        { slug: "status", name: "Status", type: "select", options: { choices: STATUS } },
        { slug: "qty", name: "Qty", type: "number" },
        {
          slug: "price",
          name: "Price",
          type: "number",
          options: { number: { format: "currency", currency: "USD" } },
        },
        { slug: "flag", name: "Flag", type: "checkbox" },
        { slug: "due", name: "Due", type: "date" },
        {
          slug: "at",
          name: "At",
          type: "date",
          options: { date: { includeTime: true, timezone: "Asia/Shanghai" } },
        },
        { slug: "site", name: "Site", type: "url" },
        { slug: "legacy", name: "Legacy", type: "text" },
      ],
    });
    if (!base.materialized) throw new Error("expected a materialized Base");

    const TITLES = [
      "Apple",
      "apple",
      "APPLE",
      "Ångström",
      "angstrom",
      "İstanbul",
      "istanbul",
      "ΟΔΟΣ",
      "οδος",
      "中文",
      "中文",
      "日本語",
      "한국어",
      "item 2",
      "item 10",
      "Item 2",
      "-",
      "",
      " ",
      "😀 smile",
      "Zoë",
      "zoe",
      "a%b",
      "a_b",
      "back\\slash",
      "100",
      "-3",
    ];
    const QTY = [-3, -10, 0, 1.5, 1.25, 2, 10, 100, 1e21, 7, 7, 42];
    const PRICE = [1234.5, 0, -1, 99.99, 1234.5];
    const DUE = [
      "2026-10-02",
      "2026-01-15",
      "2025-12-31",
      "2026-10-02",
      "2026-10-02T09:30:00.000Z",
    ];
    const AT = [
      "2026-10-02T18:00:00.000Z",
      "2026-10-02T15:59:00.000Z",
      "2026-10-01T16:00:00.000Z",
      "2026-10-02T18:00:00.000Z",
    ];
    const SITES = ["https://A.example", "https://a.example", "https://b.example/中文"];
    const records: Array<Record<string, unknown>> = [];
    for (let index = 0; index < 48; index++) {
      const pick = <T>(list: readonly T[], stride: number, gap: number): T | undefined =>
        index % gap === gap - 1 ? undefined : list[(index * stride) % list.length];
      const fields: Record<string, unknown> = {};
      const set = (slug: string, value: unknown) => {
        if (value !== undefined) fields[slug] = value;
      };
      set("title", pick(TITLES, 1, 13));
      set("status", pick(STATUS, 3, 5)?.id);
      set("qty", pick(QTY, 5, 7));
      set("price", pick(PRICE, 2, 6));
      set("flag", index % 4 === 3 ? undefined : index % 2 === 0);
      set("due", pick(DUE, 3, 6));
      set("at", pick(AT, 1, 4));
      set("site", pick(SITES, 1, 5));
      set("legacy", `old ${index % 3}`);
      if (index === 5) set("body", `${"x".repeat(8100)}TAIL-ONE`);
      else if (index === 6) set("body", `${"x".repeat(8100)}TAIL-TWO`);
      else set("body", index % 3 === 0 ? undefined : `note ${index % 4}`);
      records.push(fields);
    }
    const bulk = await client.bases.createBulkChangeRequest({ baseId: base.id, records });
    await client.changeRequests.review({ changeRequestIds: [bulk.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [bulk.id] });
    const all = await db
      .select({ id: busabaseRecords.id })
      .from(busabaseRecords)
      .where(eq(busabaseRecords.baseId, base.id))
      .orderBy(busabaseRecords.id);
    const ids = all.map((row) => row.id);
    expect(ids).toHaveLength(48);

    // Archived, pending update, pending create.
    await client.records.changeRequest({
      operation: "delete",
      recordId: ids[0] as string,
      autoMerge: true,
    });
    await client.records.changeRequest({
      operation: "update",
      recordId: ids[1] as string,
      fields: { title: "PENDING", status: "c_todo", qty: 999, flag: true },
      autoMerge: false,
    });
    await client.bases.createChangeRequest({
      baseId: base.id,
      fields: { title: "PENDING CREATE", status: "c_done", qty: 5 },
      autoMerge: false,
    });

    // A slug reused after its field was deleted: old commits still carry the
    // old value under it, the projection tombstoned those rows.
    const legacyField = base.fields.find((field) => field.slug === "legacy");
    if (!legacyField) throw new Error("legacy field");
    const merge = async (id: string) => {
      await client.changeRequests.review({ changeRequestIds: [id], verdict: "approved" });
      await client.changeRequests.merge({ changeRequestIds: [id] });
    };
    await merge(
      (
        await client.bases.fieldChangeRequest({
          operation: "delete",
          baseId: base.id,
          fieldId: legacyField.id,
        })
      ).id,
    );
    await merge(
      (
        await client.bases.fieldChangeRequest({
          operation: "create",
          baseId: base.id,
          slug: "legacy",
          type: "text",
          name: "Legacy again",
          required: false,
        })
      ).id,
    );
    for (const recordId of ids.slice(2, 6)) {
      await client.records.changeRequest({
        operation: "update",
        recordId,
        fields: { legacy: "new value" },
        autoMerge: true,
      });
    }

    // Ties: same updatedAt for a group, and two values in the same millisecond
    // whose microseconds order them against their ids.
    await db
      .update(busabaseRecords)
      .set({ updatedAt: new Date("2026-03-01T00:00:00.000Z") })
      .where(inArray(busabaseRecords.id, ids.slice(10, 20)));
    await db.execute(
      sql`update busabase_records set updated_at = '2026-03-02 00:00:00.123789' where id = ${ids[21]}`,
    );
    await db.execute(
      sql`update busabase_records set updated_at = '2026-03-02 00:00:00.123456' where id = ${ids[22]}`,
    );

    const fields = (await client.bases.get({ baseId: base.id })).fields as BaseFieldVO[];
    const field = (slug: string) => {
      const found = fields.find((entry) => entry.slug === slug);
      if (!found) throw new Error(slug);
      return found;
    };

    const reference = async (filters: ViewFilterConditionVO[], sorts: ViewSortVO[]) => {
      const rows = await db
        .select({
          id: busabaseRecords.id,
          updatedAt: busabaseRecords.updatedAt,
          fields: busabaseCommits.payload,
        })
        .from(busabaseRecords)
        .innerJoin(busabaseCommits, eq(busabaseCommits.id, busabaseRecords.headCommitId))
        .where(and(eq(busabaseRecords.baseId, base.id), eq(busabaseRecords.status, "active")));
      return applyViewConfigToEvaluableRecords(
        rows.map((row) => ({
          id: row.id,
          updatedAt: row.updatedAt.toISOString(),
          fields: (row.fields ?? {}) as Record<string, unknown>,
        })),
        fields,
        { filters, sorts },
      );
    };

    const views = new Map<string, string>();
    const viewFor = async (sorts: ViewSortVO[], viewFilters: ViewFilterConditionVO[] = []) => {
      const key = JSON.stringify([sorts, viewFilters]);
      const existing = views.get(key);
      if (existing) return existing;
      const slug = `sorted-${views.size}`;
      await client.views.changeRequest({
        operation: "create",
        baseId: base.id,
        slug,
        name: slug,
        config: { filters: viewFilters, sorts } as never,
        autoMerge: true,
      });
      const created = (await client.bases.listViews({ baseId: base.id })).find(
        (view) => view.slug === slug,
      );
      if (!created) throw new Error("view");
      views.set(key, created.id);
      return created.id;
    };

    const failures: string[] = [];
    let compared = 0;
    const compare = async (
      label: string,
      filters: ViewFilterVO[],
      sorts: ViewSortVO[],
      viewFilters: ViewFilterConditionVO[] = [],
    ) => {
      const viewId =
        sorts.length || viewFilters.length ? await viewFor(sorts, viewFilters) : undefined;
      const expected = await reference(
        combineViewFilters({ filters: viewFilters }, filters),
        sorts,
      );
      const expectedIds = expected.map((row) => row.id);
      const got: string[] = [];
      let total = -1;
      for (let page = 1; page <= 20; page++) {
        const result = await client.records.listPage({
          baseId: base.id,
          ...(viewId ? { viewId } : {}),
          ...(filters.length ? { filters } : {}),
          page,
          pageSize: 7,
        });
        total = result.total;
        got.push(...result.records.map((record) => record.id));
        if (page >= result.totalPages) break;
      }
      compared++;
      // Without any filter or sort there is no view to evaluate: that page is
      // the plain newest-created-first listing, so only membership is compared.
      const plainListing = !viewId && filters.length === 0;
      if (plainListing) {
        got.sort();
        expectedIds.sort();
      }
      if (total !== expectedIds.length || JSON.stringify(got) !== JSON.stringify(expectedIds)) {
        failures.push(`${label}: page ids/total differ (got ${total}, want ${expectedIds.length})`);
      }
      if (sorts.length === 0) {
        const counted = await client.records.count({
          baseId: base.id,
          ...(viewId ? { viewId } : {}),
          ...(filters.length ? { filters } : {}),
        });
        if (counted.total !== expectedIds.length) {
          failures.push(`${label}: count ${counted.total} != ${expectedIds.length}`);
        }
        for (const groupSlug of ["status", "flag"]) {
          const grouped = await client.records.groupBy({
            baseId: base.id,
            fieldSlug: groupSlug,
            ...(viewId ? { viewId } : {}),
            ...(filters.length ? { filters } : {}),
          });
          const buckets = new Map<string | null, number>();
          for (const row of expected) {
            const key = groupKeyForValue(row.fields[groupSlug], field(groupSlug).type);
            buckets.set(key, (buckets.get(key) ?? 0) + 1);
          }
          const got = Object.fromEntries(
            grouped.groups.map((group) => [String(group.value), group.count]),
          );
          const want = Object.fromEntries([...buckets].map(([key, value]) => [String(key), value]));
          if (
            JSON.stringify(Object.entries(got).sort()) !==
            JSON.stringify(Object.entries(want).sort())
          ) {
            failures.push(
              `${label}: groupBy ${groupSlug} ${JSON.stringify(got)} != ${JSON.stringify(want)}`,
            );
          }
        }
      }
    };

    // ── Every field × operator, with values aimed at the disagreements ──
    const VALUES: Record<string, unknown[]> = {
      title: [
        "apple",
        "APPLE",
        "İ",
        "istanbul",
        "οδος",
        "ΟΔΟΣ",
        "中",
        "中文",
        "item 2",
        "-",
        "",
        "%",
        "_",
        "\\",
        "zoe",
        "ë",
        "100",
      ],
      body: [`${"x".repeat(8100)}TAIL-ONE`, "note 1", "x", "TAIL"],
      status: [...STATUS.map((choice) => choice.id), "done", "item", "-", "nope"],
      qty: ["7", "-3", "1.5", "1e+21", "1", "0", "-"],
      price: ["$1,234.50", "1234.5", "$0.00", "-$1.00"],
      flag: ["Yes", "no", "true"],
      due: ["2026-10-02", "2026-10", "not a date", ""],
      at: ["2026-10-02", "2026-10-03", "2026-10-02 23:59", "2026-10-03 02:00"],
      site: ["a.example", "HTTPS://A.EXAMPLE", "中文"],
      legacy: ["old 1", "new value", "old"],
    };
    const OPERATORS = [
      "contains",
      "equals",
      "not_empty",
      "is_empty",
      "is_true",
      "is_false",
    ] as const;
    const leafFilters: ViewFilterVO[] = [];
    for (const [slug, values] of Object.entries(VALUES)) {
      for (const operator of OPERATORS) {
        const takesValue = operator === "contains" || operator === "equals";
        for (const value of takesValue ? values : [undefined]) {
          leafFilters.push({
            fieldSlug: slug,
            operator,
            ...(takesValue ? { value } : {}),
          } as ViewFilterVO);
        }
      }
    }
    const SORTS: ViewSortVO[][] = [[]];
    for (const slug of Object.keys(VALUES)) {
      SORTS.push([{ fieldSlug: slug, direction: "asc" }], [{ fieldSlug: slug, direction: "desc" }]);
    }
    SORTS.push(
      [
        { fieldSlug: "status", direction: "asc" },
        { fieldSlug: "qty", direction: "desc" },
      ],
      [
        { fieldSlug: "flag", direction: "desc" },
        { fieldSlug: "title", direction: "asc" },
      ],
      [{ fieldSlug: "no-such-field", direction: "asc" }],
    );

    for (const filter of leafFilters) {
      for (const sorts of [[], [{ fieldSlug: "title", direction: "asc" as const }]]) {
        await compare(`${JSON.stringify(filter)} sort ${JSON.stringify(sorts)}`, [filter], sorts);
      }
    }
    for (const sorts of SORTS) {
      for (const filters of [
        [],
        [{ fieldSlug: "status", operator: "not_empty" } as ViewFilterVO],
        [{ fieldSlug: "flag", operator: "is_false" } as ViewFilterVO],
      ]) {
        await compare(
          `sort ${JSON.stringify(sorts)} filter ${JSON.stringify(filters)}`,
          filters,
          sorts,
        );
      }
    }
    // Saved OR groups, a field id, a field the Base doesn't have.
    const grouped = [
      {
        conjunction: "or",
        conditions: [
          { fieldSlug: "status", operator: "equals", value: "c_done" },
          { fieldSlug: "qty", operator: "equals", value: "7" },
        ],
      },
      {
        conjunction: "or",
        conditions: [
          { fieldSlug: "body", operator: "contains", value: "TAIL-ONE" },
          { fieldSlug: "flag", operator: "is_true" },
        ],
      },
    ] as unknown as ViewFilterConditionVO[];
    for (const condition of grouped) {
      const label = JSON.stringify(condition).slice(0, 80);
      await compare(`group ${label}`, [], [], [condition]);
      await compare(
        `group+sort ${label}`,
        [],
        [{ fieldSlug: "qty", direction: "asc" }],
        [condition],
      );
      await compare(
        `group+adhoc ${label}`,
        [{ fieldSlug: "flag", operator: "is_false" }],
        [],
        [condition],
      );
    }
    // A saved condition addresses its field by id after a rename.
    await compare(
      "by field id",
      [],
      [{ fieldSlug: "due", direction: "desc" }],
      [{ fieldSlug: "renamed", fieldId: field("status").id, operator: "equals", value: "c_todo" }],
    );
    await compare("unknown field", [{ fieldSlug: "ghost", operator: "is_empty" }], []);

    // As a member who is not a space manager.
    await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "equivalence-member",
        isSpaceManager: false,
        permissionLevel: "read",
      },
      async () => {
        await compare(
          "member status",
          [{ fieldSlug: "status", operator: "equals", value: "c_done" }],
          [{ fieldSlug: "qty", direction: "desc" }],
        );
      },
    );

    expect(failures).toEqual([]);

    // The comparison only means something if SQL actually decided most of it.
    const scope = [eq(busabaseRecords.baseId, base.id), eq(busabaseRecords.status, "active")];
    let pushedLeaves = 0;
    for (const filter of leafFilters) {
      const plan = await planViewSql(db, {
        baseId: base.id,
        fields,
        filters: [filter],
        sorts: null,
        scope,
      });
      if (plan.pushed.length === 1) pushedLeaves++;
      if (filter.fieldSlug === "body" || filter.fieldSlug === "legacy") {
        expect(plan.residual, JSON.stringify(filter)).toHaveLength(1);
      }
    }
    const ordered = [];
    for (const sorts of SORTS) {
      const plan = await planViewSql(db, { baseId: base.id, fields, filters: [], sorts, scope });
      if (plan.order) ordered.push(sorts.map((sort) => sort.fieldSlug).join(","));
    }
    const decidableLeaves = leafFilters.filter(
      (filter) => filter.fieldSlug !== "body" && filter.fieldSlug !== "legacy",
    ).length;
    expect(pushedLeaves).toBe(decidableLeaves);
    expect(ordered.sort()).toEqual(
      [
        "",
        "at",
        "at",
        "due",
        "due",
        "flag",
        "flag",
        "flag,title",
        "price",
        "price",
        "qty",
        "qty",
        "site",
        "site",
        "status",
        "status",
        "status,qty",
        "title",
        "title",
      ].sort(),
    );
    expect(compared).toBeGreaterThan(400);

    // An id `localeCompare` orders differently from code points: the order can
    // no longer be proven, so it is left to the comparator — still identical.
    const [template] = await db
      .select()
      .from(busabaseRecords)
      .where(eq(busabaseRecords.id, ids[12] as string));
    if (!template) throw new Error("template");
    await db.insert(busabaseRecords).values({ ...template, id: "recZ_Upper" });
    const templateValues = await db
      .select()
      .from(busabaseFieldValues)
      .where(eq(busabaseFieldValues.recordId, ids[12] as string));
    await db.insert(busabaseFieldValues).values(
      templateValues.map((row, index) => ({
        ...row,
        id: `fvl_upper_${index}`,
        recordId: "recZ_Upper",
      })),
    );
    const afterOddId = await planViewSql(db, {
      baseId: base.id,
      fields,
      filters: [],
      sorts: [{ fieldSlug: "status", direction: "asc" }],
      scope,
    });
    expect(afterOddId.order).toBeNull();
    for (const sorts of [[], [{ fieldSlug: "status", direction: "asc" as const }]]) {
      await compare(`odd id sort ${JSON.stringify(sorts)}`, [], sorts);
      await compare(
        `odd id filtered sort ${JSON.stringify(sorts)}`,
        [{ fieldSlug: "flag", operator: "is_false" }],
        sorts,
      );
    }
    expect(failures).toEqual([]);

    // A record with two live rows for one field (the projection's
    // delete-then-insert should prevent it, nothing enforces it) must still be
    // listed once when sorted by it and counted once when grouped by it.
    await db.delete(busabaseRecords).where(eq(busabaseRecords.id, "recZ_Upper"));
    const [statusRow] = await db
      .select()
      .from(busabaseFieldValues)
      .where(
        and(
          eq(busabaseFieldValues.recordId, ids[30] as string),
          eq(busabaseFieldValues.fieldSlug, "status"),
        ),
      );
    if (!statusRow) throw new Error("status row");
    await db.insert(busabaseFieldValues).values({ ...statusRow, id: "fvl_duplicate_status" });
    const duplicated = await planViewSql(db, {
      baseId: base.id,
      fields,
      filters: [{ fieldSlug: "status", operator: "not_empty" }],
      sorts: [{ fieldSlug: "status", direction: "asc" }],
      scope,
    });
    expect(duplicated.order).not.toBeNull();
    expect(duplicated.residual).toHaveLength(0);
    await compare("duplicate row", [], []);
    await compare("duplicate row filtered", [{ fieldSlug: "flag", operator: "is_true" }], []);
    await compare("duplicate row sorted", [], [{ fieldSlug: "status", direction: "desc" }]);
    expect(failures).toEqual([]);
  });
});
