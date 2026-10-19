import type { BaseFieldVO, BaseVO, ViewVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { getFieldDependencies } from "./field-dependencies";

const field = (
  id: string,
  baseId: string,
  slug: string,
  type: BaseFieldVO["type"] = "text",
  options: BaseFieldVO["options"] = {},
): BaseFieldVO => ({ id, baseId, slug, name: slug, type, options, required: false, position: 0 });

const base = (id: string, fields: BaseFieldVO[]): BaseVO => ({
  id,
  nodeId: `node-${id}`,
  slug: id,
  name: id,
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: "2026-10-09T00:00:00.000Z",
  fields,
});

const view = (
  id: string,
  config: ViewVO["config"],
  status: ViewVO["status"] = "active",
): ViewVO => ({
  id,
  baseId: "customers",
  slug: id,
  name: id,
  description: "",
  type: "table",
  config,
  status,
  createdBy: "user",
  archivedAt: null,
  createdAt: "2026-10-09T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
});

describe("field dependency inventory", () => {
  it("lists view rules and display settings, preferring stable field IDs over reused slugs", () => {
    const target = field("new-id", "customers", "status");
    const views = [
      view("current", {
        filters: [{ fieldId: "new-id", fieldSlug: "status", operator: "equals", value: "open" }],
        sorts: [{ fieldId: "old-id", fieldSlug: "status", direction: "asc" }],
        stackByFieldSlug: "status",
      }),
      view("legacy", {
        filters: [],
        sorts: [{ fieldSlug: "status", direction: "desc" }],
        visibleFieldSlugs: ["status"],
      }),
      view(
        "archived",
        {
          filters: [{ fieldSlug: "status", operator: "equals" }],
          sorts: [],
        },
        "archived",
      ),
    ];
    expect(
      getFieldDependencies(target, [base("customers", [target])], views).map((entry) => [
        entry.view?.id,
        entry.kind,
      ]),
    ).toEqual([
      ["current", "viewFilter"],
      ["current", "viewDisplay"],
      ["legacy", "viewSort"],
      ["legacy", "viewDisplay"],
    ]);
  });

  it("parses formulas and finds lookups through local relations and into other Bases", () => {
    const target = field("target", "customers", "score");
    const inverse = field("inverse", "customers", "tasks", "relation", {
      inverseFieldId: "remote-relation",
    });
    const remoteRelation = field("remote-relation", "tasks", "customer", "relation", {
      targetBaseId: "customers",
      inverseFieldId: "inverse",
    });
    const own = base("customers", [
      target,
      field("formula", "customers", "weighted", "formula", {
        formula: { expression: "{score} * 2" },
      }),
      field("not-formula-ref", "customers", "notes", "formula", {
        formula: { expression: '"{score}"' },
      }),
      inverse,
    ]);
    const remote = base("tasks", [
      remoteRelation,
      field("remote-lookup", "tasks", "customer_score", "lookup", {
        lookup: { relationFieldSlug: "customer", targetFieldSlug: "score" },
      }),
    ]);
    expect(
      getFieldDependencies(target, [own, remote], []).map((entry) => [
        entry.kind,
        entry.base.id,
        entry.name,
      ]),
    ).toEqual([
      ["formula", "customers", "weighted"],
      ["lookup", "tasks", "customer_score"],
    ]);
    expect(
      getFieldDependencies(remoteRelation, [own, remote], []).map((entry) => entry.kind),
    ).toContain("lookup");
    expect(getFieldDependencies(inverse, [own, remote], []).map((entry) => entry.kind)).toContain(
      "relation",
    );
  });
});

describe("field dependencies from a links-only catalog", () => {
  // `bases.list({ fields: "links" })` keeps only relation and lookup fields;
  // the open Base is always passed complete. That must find exactly what the
  // full catalog finds, for every field of the open Base.
  const customers = base("customers", [
    field("c-name", "customers", "name"),
    field("c-tier", "customers", "tier", "select", {
      choices: [{ id: "gold", name: "Gold" }],
    }),
    field("c-orders", "customers", "orders", "relation", {
      targetBaseId: "orders",
      inverseFieldId: "o-customer",
    }),
    field("c-score", "customers", "score", "formula", {
      formula: { expression: "{tier} & {name}" },
    }),
    field("c-total", "customers", "total", "lookup", {
      lookup: { relationFieldSlug: "orders", targetFieldSlug: "amount" },
    }),
  ]);
  const orders = base("orders", [
    field("o-amount", "orders", "amount", "number"),
    field("o-note", "orders", "note"),
    field("o-customer", "orders", "customer", "relation", {
      targetBaseId: "customers",
      inverseFieldId: "c-orders",
    }),
    field("o-tier", "orders", "customer_tier", "lookup", {
      lookup: { relationFieldSlug: "customer", targetFieldSlug: "tier" },
    }),
  ]);
  const invoices = base("invoices", [
    field("i-title", "invoices", "title"),
    field("i-customer", "invoices", "customer", "relation", { targetBaseId: "customers" }),
    field("i-name", "invoices", "customer_name", "lookup", {
      lookup: { relationFieldSlug: "customer", targetFieldSlug: "name" },
    }),
  ]);
  const linksOnly = (item: BaseVO): BaseVO => ({
    ...item,
    fields: item.fields.filter((f) => f.type === "relation" || f.type === "lookup"),
  });
  const summarize = (dependencies: ReturnType<typeof getFieldDependencies>) =>
    dependencies.map((dependency) => `${dependency.kind}:${dependency.base.id}:${dependency.name}`);

  it.each(customers.fields.map((f) => [f.slug, f] as const))(
    "finds the same dependencies for %s",
    (_slug, target) => {
      const full = getFieldDependencies(target, [customers, orders, invoices], []);
      const links = getFieldDependencies(
        target,
        [customers, linksOnly(orders), linksOnly(invoices)],
        [],
      );
      expect(summarize(links)).toEqual(summarize(full));
    },
  );

  it("still sees the cross-Base lookups and inverse relations (the fixture is not vacuous)", () => {
    const tier = customers.fields.find((f) => f.slug === "tier") as BaseFieldVO;
    const ordersRelation = customers.fields.find((f) => f.slug === "orders") as BaseFieldVO;
    const name = customers.fields.find((f) => f.slug === "name") as BaseFieldVO;
    const catalog = [customers, linksOnly(orders), linksOnly(invoices)];
    expect(summarize(getFieldDependencies(tier, catalog, []))).toEqual([
      "formula:customers:score",
      "lookup:orders:customer_tier",
    ]);
    expect(summarize(getFieldDependencies(ordersRelation, catalog, []))).toEqual([
      "lookup:customers:total",
      "relation:orders:customer",
    ]);
    expect(summarize(getFieldDependencies(name, catalog, []))).toContain(
      "lookup:invoices:customer_name",
    );
  });
});
