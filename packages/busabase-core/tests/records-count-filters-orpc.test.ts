import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * `records.count` with `viewId` / `filters` MUST be exact — unlike `records.list`'s
 * filter push-down (a SUPERSET the client narrows), there is no client here to
 * narrow a wrong number before it lands on a dashboard tile. These tests pin
 * both halves of that contract: the cheap SQL-COUNT path for provably-exact
 * conditions, and the hydrate/evaluate fallback for everything else — both
 * checked against hand-computed expected totals from a fixed seed set.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("records.count filters/viewId — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-count-filters-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-count-filters-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "prs",
      name: "PRs",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "branch", name: "Branch", type: "text", required: false, options: {} },
        { slug: "bio", name: "Bio", type: "html", required: false, options: {} },
        {
          slug: "stage",
          name: "Stage",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "c_open", name: "Open" },
              { id: "c_merged", name: "Merged" },
            ],
          },
        },
        { slug: "score", name: "Score", type: "number", required: false, options: {} },
        { slug: "active", name: "Active", type: "checkbox", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;

    // Fixed seed — every expectation below is hand-counted from this table.
    // #1/#2 `bio` is the exactness differentiator for `contains`: #1's "fix"
    // only appears in a tag ATTRIBUTE (stripped away by the client's html
    // preview), #2's appears in the visible text. A superset raw-ILIKE would
    // wrongly count both; the exact fallback must count only #2.
    const records: Array<Record<string, unknown>> = [
      {
        name: "PR 1",
        branch: "main",
        bio: '<p class="fix">Bug report</p>',
        stage: "c_open",
        score: 10,
        active: true,
      },
      {
        name: "PR 2",
        branch: "main",
        bio: "<p>Fix the bug</p>",
        stage: "c_merged",
        score: 20,
        active: false,
      },
      { name: "PR 3", branch: "develop", bio: "", stage: "c_open", active: true }, // score omitted
      { name: "PR 4", branch: "develop", bio: "", stage: "c_merged", score: 5, active: false },
      { name: "PR 5", branch: "", bio: "", stage: "c_open", score: 0 }, // active omitted
      { name: "PR 6", branch: "-", bio: "", stage: "c_merged", score: 15, active: false },
      { name: "PR 7", branch: "50%off", bio: "", stage: "c_open", score: 50, active: true },
      { name: "PR 8", branch: "a_b", bio: "", stage: "c_merged", active: false }, // score omitted
      { name: "PR 9", branch: "MAIN", bio: "", stage: "c_open", score: 100, active: true },
      { name: "PR 10", branch: "Feature", bio: "", stage: "c_merged", score: -5, active: false },
      { name: "PR 11", branch: "mainline", bio: "", stage: "c_open", score: 1, active: false },
    ];
    const bulk = await client.bases.createBulkChangeRequest({
      baseId,
      records,
      message: "Seed PRs",
    });
    await client.changeRequests.review({ changeRequestIds: [bulk.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [bulk.id] });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("baseId alone is unchanged: cheap SQL COUNT, no Base lookup", async () => {
    expect((await client.records.count({ baseId })).total).toBe(11);
  });

  it("text equals is exact (case-insensitive, no substring widening)", async () => {
    // PR 1 + PR 2 ("main") + PR 9 ("MAIN") match; "mainline" must NOT (equals, not contains).
    const { total } = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "branch", fieldType: "text", operator: "equals", value: "main" }],
    });
    expect(total).toBe(3);
  });

  it("text contains is exact and includes the substring superset equals excludes", async () => {
    const { total } = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "branch", fieldType: "text", operator: "contains", value: "main" }],
    });
    expect(total).toBe(4); // PR 1 "main", PR 2 "main", PR 9 "MAIN", PR 11 "mainline"
  });

  it("escapes LIKE metacharacters in the filter value (% and _ are literal, not wildcards)", async () => {
    const percent = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "branch", fieldType: "text", operator: "contains", value: "%" }],
    });
    expect(percent.total).toBe(1); // only "50%off" — an unescaped "%" would wildcard-match nearly everything

    const underscore = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "branch", fieldType: "text", operator: "contains", value: "_" }],
    });
    expect(underscore.total).toBe(1); // only "a_b"
  });

  it("text not_empty / is_empty treat both '' and the '-' placeholder as empty", async () => {
    const notEmpty = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "branch", fieldType: "text", operator: "not_empty" }],
    });
    expect(notEmpty.total).toBe(9); // excludes PR 5 ("") and PR 6 ("-")

    const empty = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "branch", fieldType: "text", operator: "is_empty" }],
    });
    expect(empty.total).toBe(2);
  });

  it("number not_empty / is_empty treat 0 as present and an omitted field as empty", async () => {
    const notEmpty = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "score", fieldType: "number", operator: "not_empty" }],
    });
    expect(notEmpty.total).toBe(9); // PR 3 and PR 8 omit score entirely

    const empty = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "score", fieldType: "number", operator: "is_empty" }],
    });
    expect(empty.total).toBe(2);
  });

  it("checkbox is_true / is_false exactly complement each other, including never-set records", async () => {
    const isTrue = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "active", fieldType: "checkbox", operator: "is_true" }],
    });
    expect(isTrue.total).toBe(4); // PR 1, 3, 7, 9

    const isFalse = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "active", fieldType: "checkbox", operator: "is_false" }],
    });
    // PR 2, 4, 5 (omitted), 6, 8 (omitted), 10, 11 — is_false must also catch
    // records that never set the field at all, not just explicit `false`.
    expect(isFalse.total).toBe(7);
    expect(isTrue.total + isFalse.total).toBe(11);
  });

  it("falls back to exact evaluation for a filter that can't be proven exact (html contains)", async () => {
    // `html` is deliberately excluded from the SQL-exact set: the client
    // preview strips tags before matching, the raw `valueText` projection
    // doesn't. Only PR 2 has "fix" in its VISIBLE text; PR 1 only has it in a
    // tag attribute. A superset raw-ILIKE would wrongly count both.
    const { total } = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "bio", fieldType: "html", operator: "contains", value: "fix" }],
    });
    expect(total).toBe(1);
  });

  it("falls back to exact evaluation for a select field (label resolution, not the stored id)", async () => {
    const { total } = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "stage", fieldType: "select", operator: "equals", value: "c_open" }],
    });
    expect(total).toBe(6); // PR 1, 3, 5, 7, 9, 11
  });

  it("combines multiple filters with AND", async () => {
    const { total } = await client.records.count({
      baseId,
      filters: [
        { fieldSlug: "branch", fieldType: "text", operator: "equals", value: "main" },
        { fieldSlug: "active", fieldType: "checkbox", operator: "is_true" },
      ],
    });
    expect(total).toBe(2); // PR 1 (main, true) and PR 9 (MAIN, true) — not PR 2 (main, false)
  });

  it("counts a saved View's rows via viewId, AND-combined with extra ad-hoc filters", async () => {
    const viewCr = await client.views.changeRequest({
      operation: "create",
      baseId,
      slug: "main-branch",
      name: "Main branch",
      config: { filters: [{ fieldSlug: "branch", operator: "equals", value: "main" }], sorts: [] },
      autoMerge: false,
    });
    await client.changeRequests.review({ changeRequestIds: [viewCr.id], verdict: "approved" });
    const merged = await client.changeRequests.merge({ changeRequestIds: [viewCr.id] });
    const mergeResult = merged.results[0];
    if (!mergeResult?.ok) throw new Error(mergeResult?.error ?? "Merge returned no result");
    const viewId = mergeResult.view?.id;
    if (!viewId) throw new Error("View merge did not return a view id");

    const viewOnly = await client.records.count({ baseId, viewId });
    expect(viewOnly.total).toBe(3); // PR 1, PR 2, PR 9 (main / main / MAIN)

    const viewPlusFilter = await client.records.count({
      baseId,
      viewId,
      filters: [{ fieldSlug: "active", fieldType: "checkbox", operator: "is_true" }],
    });
    expect(viewPlusFilter.total).toBe(2); // PR 1 (true) + PR 9 (true), PR 2 is active:false

    await expect(client.records.count({ viewId })).rejects.toThrow();
  });

  it("rejects filters without baseId (field slugs are only unambiguous within one Base)", async () => {
    await expect(
      client.records.count({
        filters: [{ fieldSlug: "branch", fieldType: "text", operator: "equals", value: "main" }],
      }),
    ).rejects.toThrow();
  });

  it("404s on an unknown viewId once baseId makes the Base resolvable", async () => {
    await expect(client.records.count({ baseId, viewId: "viw_does_not_exist" })).rejects.toThrow();
  });
});
