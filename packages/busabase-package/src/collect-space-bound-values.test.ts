/**
 * An `appUser` cell holds the id of one person in THIS space's app-user pool.
 * Exported into a template and installed elsewhere, that id names nobody — it
 * shows as "Deleted app user" and a `records/query` owner filter can never
 * match it. So export keeps the column and drops its values, the way it does
 * for file refs, and relaxes a required App user column so install cannot fail
 * on the cells it just emptied.
 */
import {
  PACKAGE_FORMAT,
  PACKAGE_SPACE_BOUND_FIELD_TYPES,
  PACKAGE_VALUELESS_FIELD_TYPES,
  type PackageManifest,
} from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import type { PackageClient } from "./client";
import { collectPackageTree, type SourceNode } from "./collect";
import type { PackageBaseNode } from "./tree";

const manifest = (): PackageManifest => ({
  format: PACKAGE_FORMAT,
  name: "shop",
  description: "",
  tags: [],
});

const fields = [
  { id: "fld-title", slug: "title", name: "Title", type: "text", required: false, position: 0 },
  { id: "fld-buyer", slug: "buyer", name: "Buyer", type: "appUser", required: true, position: 1 },
].map((field) => ({ ...field, baseId: "bse-orders", options: {} }));

const base = {
  id: "bse-orders",
  nodeId: "nod-orders",
  slug: "orders",
  name: "Orders",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  fields,
};

const record = (id: string, values: Record<string, unknown>) => ({
  id,
  status: "active",
  headCommit: { payload: values },
});

const client = {
  nodes: { getAgentPrompts: async () => ({ agentPrompts: null }) },
  bases: {
    get: async () => base,
    list: async () => [base],
    listViews: async () => [],
  },
  records: {
    list: async () => ({
      records: [
        record("rec-1", { title: "Order 1", buyer: "apu_ann" }),
        record("rec-2", { title: "Order 2", buyer: "apu_bob" }),
        record("rec-3", { title: "Guest order", buyer: "" }),
      ],
      nextCursor: null,
    }),
  },
} as unknown as PackageClient;

const root: SourceNode = {
  id: "nod-orders",
  slug: "orders",
  name: "Orders",
  type: "base",
  baseId: "bse-orders",
  description: "",
  position: 0,
};

describe("exporting an App user column", () => {
  it("is a space-bound type with no value in a package", () => {
    expect(PACKAGE_SPACE_BOUND_FIELD_TYPES).toEqual(["appUser", "member"]);
    expect(PACKAGE_VALUELESS_FIELD_TYPES).toEqual(
      expect.arrayContaining(["attachment", "drive", "appUser", "member"]),
    );
  });

  it("keeps the column, drops every id, relaxes required, and says so", async () => {
    const warnings: string[] = [];
    const tree = await collectPackageTree(client, root, {
      manifest: manifest(),
      warn: (message) => warnings.push(message),
      baseUrl: "http://localhost",
    });

    const node = tree.nodes[0] as PackageBaseNode;
    expect(node.base.fields.map((field) => [field.slug, field.type])).toEqual([
      ["title", "text"],
      ["buyer", "appUser"],
    ]);
    // A required App user column can never be satisfied by the package.
    expect(node.base.fields.find((field) => field.slug === "buyer")?.required).toBe(false);
    expect(node.records.map((line) => line.fields)).toEqual([
      { title: "Order 1" },
      { title: "Order 2" },
      { title: "Guest order" },
    ]);
    // Two real ids dropped (the empty guest cell is not a value).
    expect(warnings).toContainEqual(expect.stringContaining("Dropped 2 app user value(s)"));
    expect(warnings).toContainEqual(
      expect.stringContaining('appUser field "buyer" is required in the source'),
    );
  });
});

describe("exporting a Member column", () => {
  const memberFields = [
    { id: "fld-title", slug: "title", name: "Title", type: "text", required: false, position: 0 },
    { id: "fld-owner", slug: "owner", name: "Owner", type: "member", required: true, position: 1 },
  ].map((field) => ({ ...field, baseId: "bse-tasks", options: {} }));
  const tasksBase = {
    ...base,
    id: "bse-tasks",
    nodeId: "nod-tasks",
    slug: "tasks",
    name: "Tasks",
    fields: memberFields,
  };
  const memberClient = {
    nodes: { getAgentPrompts: async () => ({ agentPrompts: null }) },
    bases: { get: async () => tasksBase, list: async () => [tasksBase], listViews: async () => [] },
    records: {
      list: async () => ({
        records: [
          record("rec-1", { title: "Task 1", owner: ["usr_alice"] }),
          record("rec-2", { title: "Task 2", owner: ["usr_alice", "usr_bob"] }),
          record("rec-3", { title: "Unassigned", owner: [] }),
        ],
        nextCursor: null,
      }),
    },
  } as unknown as PackageClient;

  it("keeps the column, drops the source team's user ids, relaxes required, and says so", async () => {
    const warnings: string[] = [];
    const tree = await collectPackageTree(
      memberClient,
      { ...root, id: "nod-tasks", slug: "tasks", name: "Tasks", baseId: "bse-tasks" },
      {
        manifest: manifest(),
        warn: (message) => warnings.push(message),
        baseUrl: "http://localhost",
      },
    );
    const node = tree.nodes[0] as PackageBaseNode;
    expect(node.base.fields.find((field) => field.slug === "owner")?.type).toBe("member");
    expect(node.base.fields.find((field) => field.slug === "owner")?.required).toBe(false);
    expect(node.records.map((line) => line.fields)).toEqual([
      { title: "Task 1" },
      { title: "Task 2" },
      { title: "Unassigned" },
    ]);
    // Two assigned rows; the empty list is not a value.
    expect(warnings).toContainEqual(expect.stringContaining("Dropped 2 member value(s)"));
  });
});
