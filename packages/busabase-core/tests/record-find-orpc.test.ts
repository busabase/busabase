import { createRouterClient } from "@orpc/server";
import type { BaseVO } from "busabase-contract/types";
import { beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

describe(`current-view record find (${process.env.RECORD_FIND_TEST_POSTGRES_URL ? "PostgreSQL" : "PGLite"})`, () => {
  const client = createRouterClient(busabaseRouter);
  let base: BaseVO;
  let customers: BaseVO;
  let customerId: string;
  let viewId: string;
  let orViewId: string;
  let dynamicViewId: string;

  const fieldId = (slug: string) => {
    const field = base.fields.find((item) => item.slug === slug);
    if (!field) throw new Error(`Missing fixture field: ${slug}`);
    return field.id;
  };
  const find = (query: string, slug?: string, extra = {}) =>
    client.records.listPage({
      baseId: base.id,
      find: { query, ...(slug ? { fieldId: fieldId(slug) } : {}) },
      ...extra,
    });
  const createView = async (
    slug: string,
    config: Parameters<typeof client.views.changeRequest>[0]["config"],
  ) => {
    const cr = await client.views.changeRequest({
      operation: "create",
      baseId: base.id,
      name: slug,
      slug,
      config,
      autoMerge: false,
    });
    await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
    const [merged] = (await client.changeRequests.merge({ changeRequestIds: [cr.id] })).results;
    if (!merged?.ok || !merged.view) throw new Error("Failed to create fixture view");
    return merged.view.id;
  };

  beforeAll(async () => {
    await seedScenario("record-find", process.env.RECORD_FIND_TEST_POSTGRES_URL);
    const suffix = Date.now().toString(36);
    const createdCustomers = await client.bases.create({
      autoMerge: true,
      name: "Find customers",
      slug: `find-customers-${suffix}`,
      fields: [
        { slug: "name", name: "Customer name", type: "text" },
        { slug: "segment", name: "Segment", type: "text" },
      ],
    });
    if ("status" in createdCustomers) throw new Error("Expected materialized customer Base");
    customers = createdCustomers;
    const customer = await client.bases.createChangeRequest({
      baseId: customers.id,
      autoMerge: true,
      fields: { name: "AcmeCustomerName", segment: "Enterprise" },
    });
    if (!customer.materialized) throw new Error("Expected materialized customer");
    customerId = customer.id;
    const createdBase = await client.bases.create({
      autoMerge: true,
      name: "Find deliveries",
      slug: `find-deliveries-${suffix}`,
      fields: [
        { slug: "title", name: "Title", type: "text" },
        { slug: "notes", name: "Notes", type: "longtext" },
        { slug: "html", name: "HTML", type: "html" },
        { slug: "markdown", name: "Markdown", type: "markdown" },
        { slug: "json", name: "JSON", type: "json" },
        { slug: "code", name: "Code", type: "code" },
        { slug: "yaml", name: "YAML", type: "yaml" },
        { slug: "sequence", name: "Number", type: "auto_number" },
        { slug: "date", name: "Date", type: "date" },
        {
          slug: "status",
          name: "Status",
          type: "select",
          options: {
            choices: [
              { id: "pending", name: "待交付" },
              { id: "done", name: "已完成" },
            ],
          },
        },
        {
          slug: "tags",
          name: "Tags",
          type: "multiselect",
          options: {
            choices: [
              { id: "vip", name: "重点客户" },
              { id: "normal", name: "普通" },
            ],
          },
        },
        {
          slug: "customer",
          name: "Customer",
          type: "relation",
          options: { targetBaseId: customers.id, multiple: false },
        },
        {
          slug: "segment",
          name: "Customer segment",
          type: "lookup",
          options: { lookup: { relationFieldSlug: "customer", targetFieldSlug: "segment" } },
        },
      ],
    });
    if ("status" in createdBase) throw new Error("Expected materialized deliveries Base");
    base = createdBase;
    const bulk = await client.bases.createBulkChangeRequest({
      baseId: base.id,
      autoMerge: false,
      records: Array.from({ length: 500 }, (_, index) => ({
        title: index === 436 ? "Needle437" : `Delivery ${String(index + 1).padStart(3, "0")}`,
        notes: index === 436 ? `${"长".repeat(12_000)}尾部关键词` : "Ordinary notes",
        html:
          index === 436
            ? "<p>华<strong>星</strong>&nbsp;客户</p><script>phantomsecret</script>"
            : `<p>Report ${index}</p>`,
        markdown: index === 436 ? "[交付手册](https://hidden-destination.example)" : "Regular",
        json: index === 436 ? '{"secret_json_key":"华星","escaped":"\\\\u534e"}' : "{}",
        code: index === 436 ? "const secret_code_key = 1;" : "",
        yaml: index === 436 ? "secret_yaml_key: value" : "",
        status: index % 2 === 0 ? "pending" : "done",
        tags: [index % 5 === 0 ? "vip" : "normal"],
        customer: [customerId],
      })),
    });
    await client.changeRequests.review({ changeRequestIds: [bulk.id], verdict: "approved" });
    const [merged] = (await client.changeRequests.merge({ changeRequestIds: [bulk.id] })).results;
    if (!merged?.ok) throw new Error(merged?.error ?? "Failed to seed deliveries");
    viewId = await createView("pending-deliveries", {
      filters: [{ fieldSlug: "status", operator: "equals", value: "pending" }],
      sorts: [{ fieldSlug: "title", direction: "asc" }],
    });
    orViewId = await createView("or-deliveries", {
      filterConjunction: "or",
      filters: [
        { fieldSlug: "title", operator: "contains", value: "Needle" },
        { fieldSlug: "title", operator: "equals", value: "Delivery 002" },
      ],
      sorts: [{ fieldSlug: "title", direction: "asc" }],
    });
    dynamicViewId = await createView("enterprise-deliveries", {
      filters: [{ fieldSlug: "segment", operator: "contains", value: "Enterprise" }],
      sorts: [{ fieldSlug: "title", direction: "asc" }],
    });
  }, 120_000);

  it("finds an older record beyond the first loaded page, case insensitively", async () => {
    const result = await find("needle437");
    expect(result.total).toBe(1);
    expect(result.records[0]?.headCommit.payload.title).toBe("Needle437");
  });

  it("matches complete long-text tails and static HTML/Markdown body text", async () => {
    expect((await find("尾部关键词")).total).toBe(1);
    expect((await find("华星", "html")).total).toBe(1);
    expect((await find("华星 客户", "html")).total).toBe(1);
    expect((await find("phantomsecret")).total).toBe(0);
    expect((await find("交付手册", "markdown")).total).toBe(1);
    expect((await find("hidden-destination")).total).toBe(0);
  });

  it("uses option labels, and keeps source-only fields outside common find", async () => {
    expect((await find("待交付")).total).toBe(250);
    expect((await find("重点", "tags")).total).toBe(100);
    expect((await find("secret_json_key")).total).toBe(0);
    expect((await find("secret_json_key", "json")).total).toBe(1);
    expect((await find("secret_code_key", "code")).total).toBe(1);
    expect((await find("secret_yaml_key", "yaml")).total).toBe(1);
    expect((await find("%_", "title")).total).toBe(0);
  });

  it("intersects saved filters, preserves sort, and pages the complete matching set", async () => {
    const viewsBefore = await client.bases.listViews({ baseId: base.id });
    const first = await find("Delivery", "title", { viewId, pageSize: 100 });
    const second = await find("Delivery", "title", { viewId, pageSize: 100, page: 2 });
    const third = await find("Delivery", "title", { viewId, pageSize: 100, page: 3 });
    expect(first.total).toBe(249);
    const titles = [...first.records, ...second.records, ...third.records].map(
      (r) => r.headCommit.payload.title,
    );
    expect(new Set(titles).size).toBe(249);
    expect(titles[0]).toBe("Delivery 001");
    expect(titles.at(-1)).toBe("Delivery 499");
    expect((await find("Delivery", "title", { viewId: orViewId })).total).toBe(1);
    expect((await find("尾部关键词", "notes", { viewId: dynamicViewId })).total).toBe(1);
    expect(await client.bases.listViews({ baseId: base.id })).toEqual(viewsBefore);
  });

  it("keeps saved-view tie order and explicit SQL order when filtering before sorting", async () => {
    const tiedViewId = await createView("find-tied-status", {
      filters: [],
      sorts: [{ fieldSlug: "status", direction: "asc" }],
    });
    const fullPages = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        client.records.listPage({
          baseId: base.id,
          viewId: tiedViewId,
          page: index + 1,
          pageSize: 100,
        }),
      ),
    );
    const expected = fullPages
      .flatMap((page) => page.records)
      .filter((record) => String(record.headCommit.payload.title).includes("Delivery 00"));
    expect(expected).toHaveLength(9);
    const pages = await Promise.all(
      [1, 2, 3].map((page) =>
        find("Delivery 00", "title", { viewId: tiedViewId, page, pageSize: 3 }),
      ),
    );
    expect(pages.every((page) => page.total === 9 && page.totalPages === 3)).toBe(true);
    expect(pages.flatMap((page) => page.records.map((record) => record.id))).toEqual(
      expected.map((record) => record.id),
    );

    // All date values are missing, so the explicit SQL order's id-ASC tie
    // rule must win over the saved view comparator's id-DESC fallback.
    const explicit = await find("Delivery 00", "title", {
      viewId: tiedViewId,
      pageSize: 100,
      sort: { fieldSlug: "date", direction: "asc" },
    });
    expect(explicit.records.map((record) => record.id)).toEqual(
      expected.map((record) => record.id).sort(),
    );
  });

  it("keeps the original default ordering when find matches every record", async () => {
    const normal = await client.records.listPage({ baseId: base.id, page: 2, pageSize: 100 });
    const matched = await find("Ordinary", "notes", { page: 2, pageSize: 100 });
    const all = await client.records.listPage({ baseId: base.id, pageSize: 100 });
    const matchingFirst = await find("CustomerName", "customer", { pageSize: 100 });
    const matchingSecond = await find("CustomerName", "customer", { page: 2, pageSize: 100 });
    expect(matchingFirst.records.map((r) => r.id)).toEqual(all.records.map((r) => r.id));
    expect(matchingSecond.records.map((r) => r.id)).toEqual(normal.records.map((r) => r.id));
    expect(normal.records).toHaveLength(100);
    expect(matched.total).toBe(499);
  });

  it("finds selected relation titles without treating target ids as names", async () => {
    expect((await find("AcmeCustomerName")).total).toBe(0);
    expect((await find("AcmeCustomerName", "customer")).total).toBe(500);
    expect((await find(customerId, "customer")).total).toBe(0);
    const customer = await client.records.get({ recordId: customerId });
    const change = await client.records.changeRequest({
      operation: "update",
      recordId: customerId,
      baseCommitId: customer.headCommitId,
      fields: { name: "RenamedCustomer" },
      autoMerge: true,
    });
    expect(change).toBeDefined();
    expect((await find("AcmeCustomerName", "customer")).total).toBe(0);
    expect((await find("RenamedCustomer", "customer")).total).toBe(500);
  });

  it("does not let inaccessible relation titles affect matches or counts", async () => {
    await client.nodes.updateVisibility({ nodeId: customers.nodeId, visibility: "private" });
    const result = await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "find-reader",
        isSpaceManager: false,
        permissionLevel: "read",
      },
      () => find("RenamedCustomer", "customer"),
    );
    expect(result.total).toBe(0);
    await client.nodes.updateVisibility({ nodeId: customers.nodeId, visibility: "workspace" });
  });

  it("rejects stale and unsupported field selections rather than widening the scope", async () => {
    await expect(
      client.records.listPage({
        baseId: base.id,
        find: { query: "Needle", fieldId: "deleted-field" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(find("2026", "date")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects an explicitly selected relation whose title is computed", async () => {
    const suffix = Date.now().toString(36);
    const target = await client.bases.create({
      autoMerge: true,
      name: "Computed target",
      slug: `computed-target-${suffix}`,
      fields: [
        {
          slug: "title",
          name: "Title",
          type: "formula",
          options: { formula: { expression: '"Calculated title"' } },
        },
      ],
    });
    if ("status" in target) throw new Error("Expected materialized target");
    const targetRecord = await client.bases.createChangeRequest({
      autoMerge: true,
      baseId: target.id,
      fields: {},
    });
    if (!targetRecord.materialized) throw new Error("Expected materialized target record");
    const source = await client.bases.create({
      autoMerge: true,
      name: "Computed title source",
      slug: `computed-source-${suffix}`,
      fields: [
        { slug: "title", name: "Title", type: "text" },
        {
          slug: "target",
          name: "Target",
          type: "relation",
          options: { targetBaseId: target.id, multiple: false },
        },
      ],
    });
    if ("status" in source) throw new Error("Expected materialized source");
    await client.bases.createChangeRequest({
      autoMerge: true,
      baseId: source.id,
      fields: { title: "Example", target: [targetRecord.id] },
    });
    const relation = source.fields.find((f) => f.slug === "target");
    await expect(
      client.records.listPage({
        baseId: source.id,
        find: { query: "Calculated", fieldId: relation?.id },
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "unsupported_find_relation_title" },
    });
  });
});
