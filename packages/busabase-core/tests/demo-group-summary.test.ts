import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { busabaseDemoRouter } from "../src/router-demo";

// Demo mode keeps `records.groupBy` in lockstep with the real handler: the
// `filled`, `checked` and `find` additions must agree with demo listPage too.
describe("demo records.groupBy summaries", () => {
  const client = createRouterClient(busabaseDemoRouter);
  const total = async (input: {
    baseId: string;
    filters?: Array<{ fieldSlug: string; operator: string; value?: unknown }>;
    find?: { query: string };
  }) =>
    (await client.records.listPage({ ...input, filters: input.filters as never, pageSize: 25 }))
      .total;

  it("counts filled like not_empty and searches like listPage", async () => {
    const base = await client.bases.get({ baseId: "bse_local_blog" });
    const fields = base.fields.filter(
      (field) => !(field.type === "relation" && field.options.reverseOfFieldId),
    );
    const whole = await client.records.groupBy({
      baseId: base.id,
      aggregates: fields.map((field) => ({ fn: "filled" as const, fieldSlug: field.slug })),
    });
    let nonTrivial = 0;
    for (const field of fields) {
      const expected = await total({
        baseId: base.id,
        filters: [{ fieldSlug: field.slug, operator: "not_empty" }],
      });
      expect({
        field: field.slug,
        filled: whole.groups[0]?.aggregates?.[`filled:${field.slug}`],
      }).toEqual({ field: field.slug, filled: expected });
      if (expected > 0 && expected < whole.total) nonTrivial++;
    }
    expect(nonTrivial).toBeGreaterThan(0);
    const firstTitle = String(
      (await client.records.listPage({ baseId: base.id, pageSize: 1 })).records[0]?.headCommit
        .payload[base.fields[0]?.slug ?? ""] ?? "",
    );
    const find = { query: firstTitle.slice(0, 4) || "a" };
    expect((await client.records.groupBy({ baseId: base.id, find })).total).toBe(
      await total({ baseId: base.id, find }),
    );
  });

  it("counts checked like is_true, and only on a checkbox", async () => {
    const bases = await client.bases.list({});
    const withCheckbox = bases.find((base) =>
      base.fields.some((field) => field.type === "checkbox"),
    );
    if (!withCheckbox) throw new Error("Expected a demo Base with a checkbox field");
    const checkbox = withCheckbox.fields.find((field) => field.type === "checkbox");
    const other = withCheckbox.fields.find((field) => field.type !== "checkbox");
    if (!checkbox || !other) throw new Error("Expected a checkbox and another field");
    const whole = await client.records.groupBy({
      baseId: withCheckbox.id,
      aggregates: [{ fn: "checked", fieldSlug: checkbox.slug }],
    });
    const checked = whole.groups[0]?.aggregates?.[`checked:${checkbox.slug}`] ?? 0;
    // Guard against both sides being zero: the seeded demo has some checked.
    expect(checked).toBeGreaterThan(0);
    expect(checked).toBeLessThan(whole.total);
    expect(checked).toBe(
      await total({
        baseId: withCheckbox.id,
        filters: [{ fieldSlug: checkbox.slug, operator: "is_true" }],
      }),
    );
    await expect(
      client.records.groupBy({
        baseId: withCheckbox.id,
        aggregates: [{ fn: "checked", fieldSlug: other.slug }],
      }),
    ).rejects.toThrow(/needs a checkbox field/);
  });
});
