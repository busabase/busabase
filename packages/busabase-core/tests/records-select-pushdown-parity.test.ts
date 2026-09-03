import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import type { ViewConfigVO } from "busabase-contract/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyViewConfigToRecords } from "../src/domains/base/utils/view-records";
import { busabaseRouter } from "../src/router";

/**
 * `select` filters are now pushed to SQL as a *proven-exact* predicate, which
 * is only sound if the SQL answer equals what the client's own matcher would
 * produce. The client compares choice NAMES while the column stores choice
 * IDS, so the predicate resolves names→ids from the Base's choice list.
 *
 * Every case below is checked twice: against a hand-counted expectation, and
 * against the client matcher running over the full record set (`parity`). The
 * hand count alone could be wrong in the same direction as the code; the
 * parity check alone could pass if both sides were wrong together. Both must
 * agree.
 *
 * The seed deliberately includes the two shapes that make a naive
 * "valueText = filterValue" predicate wrong: two choices sharing one NAME, and
 * a choice whose name is the "-" placeholder the client reads as empty.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("select filter pushdown parity", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-select-pushdown-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-select-pushdown-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "tasks",
      name: "Tasks",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        {
          slug: "stage",
          name: "Stage",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "c_todo", name: "To do" },
              { id: "c_doing", name: "Doing" },
              { id: "c_done", name: "Done" },
              // Same NAME as c_done — the client matches by label, so a filter
              // picking either one must return BOTH records.
              { id: "c_dup", name: "Done" },
              // A legitimate "N/A" option. `recordMatchesViewFilter` treats a
              // preview text of "-" as EMPTY, so picking it reads as empty.
              { id: "c_na", name: "-" },
            ],
          },
        },
        { slug: "notes", name: "Notes", type: "html", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;

    const records: Array<Record<string, unknown>> = [
      { name: "T1", stage: "c_todo", notes: "<p>alpha</p>" },
      { name: "T2", stage: "c_doing", notes: "<p>beta</p>" },
      { name: "T3", stage: "c_done", notes: "<p>alpha</p>" },
      { name: "T4", stage: "c_dup", notes: "<p>beta</p>" },
      { name: "T5", stage: "c_na", notes: "<p>alpha</p>" },
      { name: "T6", notes: "<p>beta</p>" }, // stage unset
      { name: "T7", stage: "c_todo", notes: "<p>alpha</p>" },
      { name: "T8", stage: "c_doing", notes: "<p>beta</p>" },
    ];
    const bulk = await client.bases.createBulkChangeRequest({
      baseId,
      records,
      message: "Seed tasks",
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

  /** What the CLIENT's authoritative matcher returns for this filter. */
  const clientNames = async (config: ViewConfigVO): Promise<string[]> => {
    const all = await client.records.list({ baseId, limit: 100 });
    return applyViewConfigToRecords(all.records, config)
      .map((record) => String(record.headCommit.payload.name))
      .sort();
  };

  /**
   * What the SERVER returns via `listPage` — which deliberately takes the
   * exact-evaluation path (see the note in `listRecordsPage`), NOT the SQL
   * pushdown.
   */
  const serverNames = async (config: ViewConfigVO): Promise<string[]> => {
    const page = await client.records.listPage({
      baseId,
      filters: config.filters.map((filter) => ({ ...filter, fieldType: "select" })),
      pageSize: 100,
    });
    return page.records.map((record) => String(record.headCommit.payload.name)).sort();
  };

  /**
   * What `records.count` returns — the path that DOES build the SQL `select`
   * predicate. Kept separate from `serverNames` on purpose: an assertion that
   * only exercised `listPage` would still pass if the pushdown were never
   * reached, since both paths are meant to be exact.
   */
  const pushdownCount = async (config: ViewConfigVO): Promise<number> => {
    const { total } = await client.records.count({
      baseId,
      filters: config.filters.map((filter) => ({ ...filter, fieldType: "select" })),
    });
    return total;
  };

  const cfg = (operator: ViewConfigVO["filters"][number]["operator"], value?: unknown) =>
    ({ filters: [{ fieldSlug: "stage", operator, value }], sorts: [] }) satisfies ViewConfigVO;

  /**
   * All three answers must agree: the hand-counted expectation, the client
   * matcher, the exact-evaluation server path, and the SQL pushdown path.
   */
  const expectAllAgree = async (config: ViewConfigVO, expected: string[]) => {
    expect(await serverNames(config)).toEqual(expected); // exact-evaluation path
    expect(await clientNames(config)).toEqual(expected); // client authority
    expect(await pushdownCount(config)).toBe(expected.length); // SQL pushdown path
  };

  it("equals matches EVERY choice sharing the picked choice's name", async () => {
    // c_done and c_dup are both named "Done" → T3 and T4.
    await expectAllAgree(cfg("equals", "c_done"), ["T3", "T4"]);
    // Picking the OTHER duplicate must give the same set, not just its own row.
    await expectAllAgree(cfg("equals", "c_dup"), ["T3", "T4"]);
  });

  it("equals on a normal choice matches only that choice", async () => {
    await expectAllAgree(cfg("equals", "c_todo"), ["T1", "T7"]);
  });

  it("contains matches on the label, not the stored id", async () => {
    // expected label "doing"; the id "c_doing" would also substring-match
    // "c_doing" by accident, so this only proves label semantics because
    // "To do"/"Done" do NOT contain "doing".
    await expectAllAgree(cfg("contains", "c_doing"), ["T2", "T8"]);
  });

  it("a choice named '-' counts as EMPTY, like an unset field", async () => {
    // T5 picked the "-" choice; T6 has no value at all.
    await expectAllAgree(cfg("is_empty"), ["T5", "T6"]);
    await expectAllAgree(cfg("not_empty"), ["T1", "T2", "T3", "T4", "T7", "T8"]);
  });

  it("an empty filter value falls back rather than pushing down a wrong answer", async () => {
    // Expected label "" would also match every record with no value at all,
    // which the EXISTS predicate cannot see — so this must take the exact
    // fallback and still agree with the client.
    const config = cfg("equals", "");
    expect(await serverNames(config)).toEqual(await clientNames(config));
    expect(await pushdownCount(config)).toBe((await clientNames(config)).length);
  });

  it("an unknown choice id matches nothing, rather than everything", async () => {
    await expectAllAgree(cfg("equals", "c_ghost"), []);
  });

  it("paging a filtered set covers every record exactly once", async () => {
    // The board-column case: page through one filter in small pages and prove
    // the union is the whole filtered set — no record repeated on two pages,
    // none skipped between them. A superset page would silently drop records
    // here, which is the failure this endpoint exists to prevent.
    const filters = [{ fieldSlug: "stage", fieldType: "select", operator: "not_empty" as const }];
    const collected: string[] = [];
    let page = 1;
    let totalPages = 1;
    let reportedTotal = 0;
    do {
      const result = await client.records.listPage({ baseId, filters, page, pageSize: 2 });
      expect(result.page).toBe(page);
      expect(result.pageSize).toBe(2);
      collected.push(...result.records.map((record) => String(record.headCommit.payload.name)));
      totalPages = result.totalPages;
      reportedTotal = result.total;
      page += 1;
    } while (page <= totalPages);

    const expected = ["T1", "T2", "T3", "T4", "T7", "T8"];
    expect(reportedTotal).toBe(expected.length);
    expect(totalPages).toBe(3);
    expect([...collected].sort()).toEqual(expected); // complete
    expect(new Set(collected).size).toBe(collected.length); // no duplicates
  });

  it("ad-hoc filters AND with a saved View's own filters", async () => {
    // A board column is "the View, further narrowed by this column's choice".
    const view = await client.views.changeRequest({
      operation: "create",
      baseId,
      slug: "alpha-only",
      name: "Alpha only",
      config: {
        filters: [{ fieldSlug: "notes", operator: "contains", value: "alpha" }],
        sorts: [],
      },
      autoMerge: true,
    });
    const viewId = "id" in view ? (view.id as string) : "";
    expect(viewId).toBeTruthy();

    // notes contains "alpha" → T1, T3, T5, T7. Narrowed to stage=To do → T1, T7.
    const page = await client.records.listPage({
      baseId,
      viewId,
      filters: [{ fieldSlug: "stage", fieldType: "select", operator: "equals", value: "c_todo" }],
      pageSize: 100,
    });
    expect(page.records.map((r) => String(r.headCommit.payload.name)).sort()).toEqual(["T1", "T7"]);
    expect(page.total).toBe(2);
  });
});
