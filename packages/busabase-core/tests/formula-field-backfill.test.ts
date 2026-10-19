import { createRouterClient } from "@orpc/server";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type Database = Awaited<ReturnType<typeof seedScenario>>["db"];

describe(`formula schema changes and historical values (real ${process.env.FORMULA_TEST_POSTGRES_URL ? "PostgreSQL" : "PGLite"})`, () => {
  const client = createRouterClient(busabaseRouter);
  let db: Database;

  beforeAll(async () => {
    ({ db } = await seedScenario("formula-backfill", process.env.FORMULA_TEST_POSTGRES_URL));
  });

  const createBase = async (slug: string) => {
    const base = await client.bases.create({
      autoMerge: true,
      slug,
      name: slug,
      fields: [
        { slug: "title", name: "Title", type: "text" },
        { slug: "price", name: "Price", type: "number" },
        { slug: "qty", name: "Quantity", type: "number" },
        { slug: "updated", name: "Updated", type: "updated_time" },
        { slug: "editor", name: "Editor", type: "updated_by" },
        { slug: "sequence", name: "Sequence", type: "auto_number" },
      ],
    });
    if ("status" in base) throw new Error("Expected an applied Base");
    return base;
  };

  const createRecord = async (baseId: string, price = 10, qty = 2) => {
    const record = await client.bases.createChangeRequest({
      baseId,
      autoMerge: true,
      fields: { title: "Example", price, qty },
    });
    if (!record.materialized) throw new Error("Expected an applied record");
    return record;
  };

  const merge = async (changeRequestId: string) => {
    await client.changeRequests.review({
      changeRequestIds: [changeRequestId],
      verdict: "approved",
    });
    const [result] = (await client.changeRequests.merge({ changeRequestIds: [changeRequestId] }))
      .results;
    if (!result?.ok) {
      throw Object.assign(new Error(result?.error ?? "Merge failed"), { code: result?.code });
    }
    return result;
  };

  const addFormula = (baseId: string, slug: string, expression: string, autoMerge = true) =>
    client.bases.fieldChangeRequest({
      operation: "create",
      baseId,
      slug,
      name: slug,
      type: "formula",
      required: true,
      options: { formula: { expression } },
      autoMerge,
    });

  const field = async (baseId: string, slug: string) => {
    const result = (await client.bases.get({ baseId }))?.fields.find((def) => def.slug === slug);
    if (!result) throw new Error(`Missing field ${slug}`);
    return result;
  };

  const editFormula = async (baseId: string, slug: string, expression: string, autoMerge = true) =>
    client.bases.fieldChangeRequest({
      operation: "update",
      baseId,
      fieldId: (await field(baseId, slug)).id,
      patch: { options: { formula: { expression } }, required: true },
      autoMerge,
    });

  it("keeps pending schema inert, then backfills records and projections without modifying audit data or history", async () => {
    const base = await createBase("formula-pending-backfill");
    const original = await createRecord(base.id);
    const { busabaseCommits, busabaseFieldValues, busabaseRecords } = await import(
      "../src/db/schema"
    );
    const [originalRow] = await db
      .select()
      .from(busabaseRecords)
      .where(eq(busabaseRecords.id, original.id));
    const [priceProjection] = await db
      .select()
      .from(busabaseFieldValues)
      .where(
        and(
          eq(busabaseFieldValues.recordId, original.id),
          eq(busabaseFieldValues.fieldSlug, "price"),
          isNull(busabaseFieldValues.changeRequestId),
        ),
      );
    if (!priceProjection) throw new Error("Expected the original price projection");
    const pending = await addFormula(base.id, "total", "{price} * {qty}", false);
    expect(pending.status).toBe("in_review");
    expect(
      (await client.bases.get({ baseId: base.id }))?.fields.some((def) => def.slug === "total"),
    ).toBe(false);
    expect((await client.records.get({ recordId: original.id })).headCommitId).toBe(
      original.headCommitId,
    );

    const result = await merge(pending.id);
    const current = await client.records.get({ recordId: original.id });
    expect(current.headCommit.payload.total).toBe(20);
    expect(current.headCommit.payload).toMatchObject(original.headCommit.payload);
    expect(current.headCommitId).not.toBe(original.headCommitId);
    expect(current.headCommit.parentCommitId).toBe(original.headCommitId);
    expect(current.updatedAt).toBe(original.updatedAt);
    expect(current.createdAt).toBe(original.createdAt);
    expect(current.createdBy).toBe(original.createdBy);
    expect((await field(base.id, "total")).required).toBe(false);
    expect(result.changeRequest.mergeSummary.recordIds).toEqual([]);

    const [historical] = await db
      .select()
      .from(busabaseCommits)
      .where(eq(busabaseCommits.id, original.headCommitId));
    expect(historical?.payload).toEqual(original.headCommit.payload);
    const [currentRow] = await db
      .select()
      .from(busabaseRecords)
      .where(eq(busabaseRecords.id, original.id));
    expect(currentRow).toEqual({ ...originalRow, headCommitId: current.headCommitId });
    const [currentPrice] = await db
      .select()
      .from(busabaseFieldValues)
      .where(eq(busabaseFieldValues.id, priceProjection.id));
    expect(currentPrice).toEqual(priceProjection);
    const totalRows = await db
      .select()
      .from(busabaseFieldValues)
      .where(
        and(
          eq(busabaseFieldValues.recordId, original.id),
          eq(busabaseFieldValues.fieldSlug, "total"),
          isNull(busabaseFieldValues.changeRequestId),
        ),
      );
    expect(totalRows).toHaveLength(1);
    expect(totalRows[0]).toMatchObject({
      valueNumber: 20,
      valueText: "20",
      commitId: current.headCommitId,
    });
    const byValue = await client.records.get({
      baseId: base.id,
      fieldSlug: "total",
      valueText: "20",
    });
    expect(byValue?.id).toBe(original.id);
  });

  it("also backfills through createField and preserves formatting options", async () => {
    const base = await createBase("formula-direct-create");
    const record = await createRecord(base.id, 5, 3);
    await client.bases.createField({
      baseId: base.id,
      slug: "total",
      name: "Total",
      type: "formula",
      required: true,
      options: {
        formula: {
          expression: "{price} * {qty}",
          format: "currency",
          currency: "CNY",
          precision: 2,
        },
      },
    });
    expect((await client.records.get({ recordId: record.id })).headCommit.payload.total).toBe(15);
    expect(await field(base.id, "total")).toMatchObject({
      required: false,
      options: {
        formula: {
          format: "currency",
          currency: "CNY",
          precision: 2,
        },
      },
    });
  });

  it("normalizes inline formula required flags through direct and reviewed Base creation", async () => {
    for (const autoMerge of [true, false]) {
      const slug = autoMerge ? "formula-inline-direct" : "formula-inline-reviewed";
      const created = await client.bases.create({
        slug,
        name: slug,
        autoMerge,
        fields: [
          { slug: "price", name: "Price", type: "number" },
          {
            slug: "total",
            name: "Total",
            type: "formula",
            required: true,
            options: { formula: { expression: "{price} * 2" } },
          },
        ],
      });
      if ("status" in created) await merge(created.id);
      const base = await client.bases.get({ baseId: slug });
      expect(base?.fields.find((def) => def.slug === "total")?.required).toBe(false);
    }
  });

  it("validates formula syntax when a Base is materialized through a generic node request", async () => {
    const pending = await client.nodes.createChangeRequest({
      autoMerge: false,
      operations: [
        {
          kind: "create",
          nodeType: "base",
          slug: "formula-invalid-node-base",
          name: "Invalid formula Base",
          fields: [
            {
              slug: "total",
              name: "Total",
              type: "formula",
              options: { formula: { expression: "NOT_A_FUNCTION(1)" } },
            },
          ],
        },
      ],
    });
    await expect(merge(pending.id)).rejects.toThrow(/NOT_A_FUNCTION|unknown function/i);
    await expect(client.bases.get({ baseId: "formula-invalid-node-base" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("recalculates downstream formulas in dependency order and leaves unrelated formulas unchanged", async () => {
    const base = await createBase("formula-edit-chain");
    const record = await createRecord(base.id);
    const smaller = await createRecord(base.id, 3, 3);
    await addFormula(base.id, "total", "{price} * {qty}");
    await addFormula(base.id, "taxed", "{total} * 2");
    await addFormula(base.id, "other", "{price} + 1");
    const before = await client.records.get({ recordId: record.id });
    const pending = await editFormula(base.id, "total", "{price} * {qty} + 5", false);
    expect((await client.records.get({ recordId: record.id })).headCommit.payload.taxed).toBe(40);
    await merge(pending.id);
    const after = await client.records.get({ recordId: record.id });
    expect(after.headCommit.payload).toMatchObject({ total: 25, taxed: 50, other: 11 });
    expect(after.updatedAt).toBe(before.updatedAt);
    const { busabaseFieldValues } = await import("../src/db/schema");
    const projection = await db
      .select()
      .from(busabaseFieldValues)
      .where(
        and(
          eq(busabaseFieldValues.recordId, record.id),
          eq(busabaseFieldValues.fieldSlug, "taxed"),
          isNull(busabaseFieldValues.changeRequestId),
        ),
      );
    expect(projection).toHaveLength(1);
    expect(projection[0]?.valueNumber).toBe(50);
    const viewResult = await client.views.changeRequest({
      operation: "create",
      baseId: base.id,
      slug: "totals-desc",
      name: "Totals descending",
      type: "table",
      config: {
        filters: [{ fieldSlug: "total", operator: "not_empty" }],
        sorts: [{ fieldSlug: "total", direction: "desc" }],
      },
      autoMerge: true,
    });
    if (!viewResult.materialized) throw new Error("Expected a merged view");
    const page = await client.records.listPage({
      baseId: base.id,
      viewId: viewResult.id,
      page: 1,
      pageSize: 10,
    });
    expect(page.records.map((row) => row.id)).toEqual([record.id, smaller.id]);
    expect(page.records.map((row) => row.headCommit.payload.total)).toEqual([25, 14]);
  });

  it("rejects a stale cycle at merge time without applying any schema or record value", async () => {
    const base = await createBase("formula-stale-cycle");
    const record = await createRecord(base.id);
    await addFormula(base.id, "a", "1");
    await addFormula(base.id, "b", "2");
    const proposalA = await editFormula(base.id, "a", "{b} + 1", false);
    const proposalB = await editFormula(base.id, "b", "{a} + 1", false);
    await merge(proposalA.id);
    const before = await client.records.get({ recordId: record.id });
    await expect(merge(proposalB.id)).rejects.toThrow(/cycle/i);
    expect((await field(base.id, "b")).options.formula?.expression).toBe("2");
    expect((await client.records.get({ recordId: record.id })).headCommitId).toBe(
      before.headCommitId,
    );
  });

  it("marks a replaced dependency conflicted and refreshes its pinned identity on revision", async () => {
    const base = await createBase("formula-stale-reference");
    const pending = await addFormula(base.id, "total", "{price} * {qty}", false);
    await client.bases.fieldChangeRequest({
      operation: "delete",
      baseId: base.id,
      fieldId: (await field(base.id, "qty")).id,
      autoMerge: true,
    });
    await client.bases.createField({
      baseId: base.id,
      slug: "qty",
      name: "New Quantity",
      type: "number",
    });
    await expect(merge(pending.id)).rejects.toThrow(/dependency changed/i);
    const conflicted = await client.changeRequests.get({ changeRequestId: pending.id });
    expect(conflicted.status).toBe("conflict");
    expect(conflicted.mergeSummary.conflict).toMatchObject({
      reason: "formula_dependency_changed",
      fieldSlug: "total",
      dependencySlug: "qty",
    });
    expect(
      (await client.bases.get({ baseId: base.id }))?.fields.some((def) => def.slug === "total"),
    ).toBe(false);
    const operation = conflicted.primaryOperation;
    if (!operation) throw new Error("Expected the formula operation");
    const revised = await client.operations.revise({
      operationId: operation.id,
      fields: operation.headCommit.payload,
    });
    expect(revised.status).toBe("in_review");
    expect(revised.mergeSummary).toEqual({});
    expect(revised.primaryOperation?.headCommit.payload.formulaDependencies).toMatchObject({
      qty: (await field(base.id, "qty")).id,
    });
    await merge(pending.id);
    expect((await field(base.id, "total")).options.formula?.expression).toBe("{price} * {qty}");
  });

  it("marks a missing dependency conflicted and lets the reviewer remove it on revision", async () => {
    const base = await createBase("formula-missing-reference-revise");
    await addFormula(base.id, "total", "{price}");
    const pending = await editFormula(base.id, "total", "{price} * {qty}", false);
    const total = await field(base.id, "total");
    await client.bases.fieldChangeRequest({
      operation: "delete",
      baseId: base.id,
      fieldId: (await field(base.id, "qty")).id,
      autoMerge: true,
    });
    await expect(merge(pending.id)).rejects.toThrow(/dependency changed.*qty/i);
    const conflicted = await client.changeRequests.get({ changeRequestId: pending.id });
    expect(conflicted.status).toBe("conflict");
    expect(conflicted.mergeSummary.conflict).toMatchObject({
      reason: "formula_dependency_changed",
      fieldId: total.id,
      dependencySlug: "qty",
    });
    const operation = conflicted.primaryOperation;
    if (!operation) throw new Error("Expected the formula operation");
    // A malformed revised expression is still a BAD_REQUEST and leaves the CR conflicted.
    await expect(
      client.operations.revise({
        operationId: operation.id,
        fields: operation.headCommit.payload,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await client.changeRequests.get({ changeRequestId: pending.id })).status).toBe(
      "conflict",
    );
    const revised = await client.operations.revise({
      operationId: operation.id,
      fields: {
        ...operation.headCommit.payload,
        options: { formula: { expression: "{price} * 2" } },
      },
    });
    expect(revised.status).toBe("in_review");
    expect(revised.primaryOperation?.headCommit.payload.formulaDependencies).toEqual({
      price: (await field(base.id, "price")).id,
    });
    await merge(pending.id);
    expect((await field(base.id, "total")).options.formula?.expression).toBe("{price} * 2");
  });

  it("makes an older expression proposal revisable after a newer expression was merged", async () => {
    const base = await createBase("formula-stale-expression");
    const record = await createRecord(base.id);
    await addFormula(base.id, "total", "1");
    const older = await editFormula(base.id, "total", "2", false);
    await editFormula(base.id, "total", "3");
    const before = await client.records.get({ recordId: record.id });
    await expect(merge(older.id)).rejects.toThrow(/Formula changed/i);
    expect((await field(base.id, "total")).options.formula?.expression).toBe("3");
    expect((await client.records.get({ recordId: record.id })).headCommitId).toBe(
      before.headCommitId,
    );
    const conflicted = await client.changeRequests.get({ changeRequestId: older.id });
    expect(conflicted.status).toBe("conflict");
    expect(conflicted.mergeSummary.conflict).toMatchObject({
      reason: "formula_changed",
      fieldId: (await field(base.id, "total")).id,
      fields: ["total"],
    });
    const operation = conflicted.primaryOperation;
    if (!operation) throw new Error("Expected the formula operation");
    expect(operation.status).toBe("pending");
    expect(operation.headCommit.payload.formulaBaseExpression).toBe("1");
    const revised = await client.operations.revise({
      operationId: operation.id,
      // The production UI preserves the hidden baseline; the server must refresh it.
      fields: {
        ...operation.headCommit.payload,
        options: { formula: { expression: "4" } },
      },
    });
    expect(revised.status).toBe("in_review");
    expect(revised.mergeSummary).toEqual({});
    expect(revised.primaryOperation?.headCommit.payload.formulaBaseExpression).toBe("3");
    await merge(older.id);
    expect((await client.changeRequests.get({ changeRequestId: older.id })).status).toBe("merged");
    expect((await field(base.id, "total")).options.formula?.expression).toBe("4");
    expect((await client.records.get({ recordId: record.id })).headCommit.payload.total).toBe(4);
  });

  it("clears failed derived values when a source field is deleted and recomputes them when it is restored", async () => {
    const base = await createBase("formula-source-delete-restore");
    const record = await createRecord(base.id);
    await addFormula(base.id, "total", "{price} * {qty}");
    await addFormula(base.id, "taxed", "{total} * 2");
    const sourceId = (await field(base.id, "qty")).id;
    await client.bases.fieldChangeRequest({
      operation: "delete",
      baseId: base.id,
      fieldId: sourceId,
      autoMerge: true,
    });
    const afterDelete = await client.records.get({ recordId: record.id });
    expect(afterDelete.headCommit.payload).toMatchObject({ total: null, taxed: null });
    const { busabaseFieldValues } = await import("../src/db/schema");
    const projections = await db
      .select()
      .from(busabaseFieldValues)
      .where(
        and(
          eq(busabaseFieldValues.recordId, record.id),
          eq(busabaseFieldValues.fieldSlug, "total"),
          isNull(busabaseFieldValues.changeRequestId),
        ),
      );
    expect(projections).toHaveLength(1);
    expect(projections[0]?.valueNumber).toBeNull();
    await client.bases.fieldChangeRequest({
      operation: "restore",
      baseId: base.id,
      fieldId: sourceId,
      autoMerge: true,
    });
    const afterRestore = await client.records.get({ recordId: record.id });
    expect(afterRestore.headCommit.payload).toMatchObject({ total: 20, taxed: 40 });
    expect(afterRestore.updatedAt).toBe(record.updatedAt);
  });

  it("recalculates dependent formulas and projections when a source field changes type", async () => {
    const base = await createBase("formula-source-type-convert");
    const record = await createRecord(base.id);
    await addFormula(base.id, "total", "{price} * {qty}");
    await addFormula(base.id, "taxed", "{total} * 2");
    await client.bases.fieldChangeRequest({
      operation: "convert",
      baseId: base.id,
      fieldId: (await field(base.id, "qty")).id,
      newType: "checkbox",
      selectChoiceMode: "null_on_missing",
      autoMerge: true,
    });
    const current = await client.records.get({ recordId: record.id });
    expect(current.headCommit.payload).toMatchObject({ qty: false, total: 0, taxed: 0 });
    expect(current.updatedAt).toBe(record.updatedAt);
    const { busabaseFieldValues } = await import("../src/db/schema");
    const projection = await db
      .select()
      .from(busabaseFieldValues)
      .where(
        and(
          eq(busabaseFieldValues.recordId, record.id),
          eq(busabaseFieldValues.fieldSlug, "taxed"),
          isNull(busabaseFieldValues.changeRequestId),
        ),
      );
    expect(projection).toHaveLength(1);
    expect(projection[0]?.valueNumber).toBe(0);
  });

  it("excludes archived records until restore, then computes from the current schema", async () => {
    const base = await createBase("formula-archived-record");
    const record = await createRecord(base.id);
    await addFormula(base.id, "total", "{price} * {qty}");
    await client.records.changeRequest({
      operation: "delete",
      recordId: record.id,
      autoMerge: true,
    });
    const archived = await client.records.get({ recordId: record.id });
    await editFormula(base.id, "total", "{price} * {qty} + 1");
    expect((await client.records.get({ recordId: record.id })).headCommitId).toBe(
      archived.headCommitId,
    );
    await client.records.changeRequest({
      operation: "restore",
      recordId: record.id,
      autoMerge: true,
    });
    expect((await client.records.get({ recordId: record.id })).headCommit.payload.total).toBe(21);
  });

  it("serializes a formula edit against a concurrent source-record write and retries without stale values", async () => {
    const base = await createBase("formula-concurrent-source-write");
    const record = await createRecord(base.id);
    await addFormula(base.id, "total", "{price} * {qty}");
    const formulaProposal = await editFormula(base.id, "total", "{price} * {qty} * 3", false);
    const recordProposal = await client.records.changeRequest({
      operation: "update",
      recordId: record.id,
      fields: { price: 11 },
      autoMerge: false,
    });
    await client.changeRequests.review({
      changeRequestIds: [formulaProposal.id, recordProposal.id],
      verdict: "approved",
    });
    const ids = [formulaProposal.id, recordProposal.id];
    const outcomes = await Promise.all(
      ids.map((changeRequestId) =>
        client.changeRequests.merge({ changeRequestIds: [changeRequestId] }),
      ),
    );
    for (let index = 0; index < outcomes.length; index++) {
      const outcome = outcomes[index]?.results[0];
      if (outcome?.ok) continue;
      expect(outcome?.code).toBe("CONFLICT");
      const retryId = ids[index];
      if (!retryId) throw new Error("Missing concurrent request identity");
      const retry = await client.changeRequests.merge({ changeRequestIds: [retryId] });
      expect(retry.results[0]?.ok).toBe(true);
    }
    const current = await client.records.get({ recordId: record.id });
    expect(current.headCommit.payload).toMatchObject({ price: 11, qty: 2, total: 66 });
    const { busabaseFieldValues } = await import("../src/db/schema");
    const projections = await db
      .select()
      .from(busabaseFieldValues)
      .where(
        and(
          eq(busabaseFieldValues.recordId, record.id),
          eq(busabaseFieldValues.fieldSlug, "total"),
          isNull(busabaseFieldValues.changeRequestId),
        ),
      );
    expect(projections).toHaveLength(1);
    expect(projections[0]?.valueNumber).toBe(66);
  });

  it("rolls back schema, commits and projections when backfill fails after a previous record was processed, and retries cleanly", async () => {
    const base = await createBase("formula-atomic-backfill");
    const first = await createRecord(base.id);
    const second = await createRecord(base.id, 20);
    const pending = await addFormula(base.id, "fail_total", "{price} * {qty}", false);
    const { busabaseCommits, busabaseRecords, busabaseFieldValues } = await import(
      "../src/db/schema"
    );
    await db.execute(sql`create table formula_backfill_test_counter (value integer)`);
    await db.execute(sql`create function formula_backfill_test_failure() returns trigger language plpgsql as $$
      begin
        if NEW.message = 'Recalculate formula fail_total' then
          if exists (select 1 from formula_backfill_test_counter) then
            raise exception 'Injected second-record backfill failure';
          end if;
          insert into formula_backfill_test_counter values (1);
        end if;
        return NEW;
      end $$`);
    await db.execute(
      sql`create trigger formula_backfill_test_failure before insert on busabase_commits for each row execute function formula_backfill_test_failure()`,
    );
    try {
      await expect(merge(pending.id)).rejects.toThrow();
      expect(
        (await client.bases.get({ baseId: base.id }))?.fields.some(
          (def) => def.slug === "fail_total",
        ),
      ).toBe(false);
      const rows = await db
        .select()
        .from(busabaseRecords)
        .where(eq(busabaseRecords.baseId, base.id));
      expect(new Map(rows.map((row) => [row.id, row.headCommitId]))).toEqual(
        new Map([
          [first.id, first.headCommitId],
          [second.id, second.headCommitId],
        ]),
      );
      expect(
        await db
          .select()
          .from(busabaseCommits)
          .where(
            and(
              eq(busabaseCommits.baseId, base.id),
              eq(busabaseCommits.message, "Recalculate formula fail_total"),
            ),
          ),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(busabaseFieldValues)
          .where(
            and(
              eq(busabaseFieldValues.baseId, base.id),
              eq(busabaseFieldValues.fieldSlug, "fail_total"),
            ),
          ),
      ).toHaveLength(0);
    } finally {
      await db.execute(sql`drop trigger formula_backfill_test_failure on busabase_commits`);
      await db.execute(sql`drop function formula_backfill_test_failure()`);
      await db.execute(sql`drop table formula_backfill_test_counter`);
    }
    const retry = await client.changeRequests.merge({ changeRequestIds: [pending.id] });
    expect(retry.results[0]?.ok).toBe(true);
    expect((await client.records.get({ recordId: first.id })).headCommit.payload.fail_total).toBe(
      20,
    );
  });

  it("backfills across bounded chunks on 1,000 records with matching numeric projections", async () => {
    const base = await createBase("formula-thousand-records");
    const bulk = await client.bases.createBulkChangeRequest({
      baseId: base.id,
      records: Array.from({ length: 1_000 }, (_, index) => ({
        title: `Row ${index}`,
        price: index,
        qty: 2,
      })),
      autoMerge: true,
    });
    expect(bulk.status).toBe("merged");
    const started = performance.now();
    await addFormula(base.id, "total", "{price} * {qty}");
    const elapsedMs = performance.now() - started;
    const { busabaseRecords, busabaseCommits, busabaseFieldValues } = await import(
      "../src/db/schema"
    );
    const rows = await db
      .select({ record: busabaseRecords, payload: busabaseCommits.payload })
      .from(busabaseRecords)
      .innerJoin(busabaseCommits, eq(busabaseCommits.id, busabaseRecords.headCommitId))
      .where(eq(busabaseRecords.baseId, base.id));
    const projections = await db
      .select()
      .from(busabaseFieldValues)
      .where(
        and(
          eq(busabaseFieldValues.baseId, base.id),
          eq(busabaseFieldValues.fieldSlug, "total"),
          isNull(busabaseFieldValues.changeRequestId),
        ),
      )
      .orderBy(asc(busabaseFieldValues.valueNumber));
    expect(rows).toHaveLength(1_000);
    expect(projections).toHaveLength(1_000);
    for (const { payload } of rows) expect(payload.total).toBe(Number(payload.price) * 2);
    expect(projections[0]?.valueNumber).toBe(0);
    expect(projections[999]?.valueNumber).toBe(1998);
    console.info(`[formula-backfill] 1,000 records: ${Math.round(elapsedMs)}ms`);
  }, 120_000);
});
