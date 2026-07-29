import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import {
  PACKAGE_COMPUTED_FIELD_TYPES,
  PACKAGE_DEFERRED_FIELD_TYPES,
  PACKAGE_FORMAT,
  PackageBaseFieldSchema,
  PackageFieldOptionsSchema,
} from "busabase-contract/domains/package/types";
import { applyInstall } from "busabase-package/apply";
import type { PackageClient } from "busabase-package/client";
import { buildInstallPlan, resolveTargetState } from "busabase-package/plan";
import type { PackageTree } from "busabase-package/tree";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";

/**
 * A `lookup` field has to survive export → install intact. Three distinct ways
 * it could silently not:
 *
 *  1. `PackageFieldOptionsSchema` is a plain zod object, so an unlisted key is
 *     STRIPPED, not rejected — omitting `lookup` there loses the whole config
 *     with no error anywhere.
 *  2. A lookup hops through a `relation` field on the same Base, and relations
 *     are deferred to install pass 2. A lookup created in pass 1 fails server
 *     validation because its hop doesn't exist yet.
 *  3. Lookup VALUES are read-time-derived and ride along in `headCommit.fields`,
 *     so an exporter that doesn't know they're computed exports derived data
 *     as if a human had authored it.
 *
 * Harness convention copied from install-router-client-seam.test.ts.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const lookupTree = (packageName: string): PackageTree => ({
  manifest: {
    format: PACKAGE_FORMAT,
    name: packageName,
    description: "Lookup round-trip probe",
    tags: [],
  },
  nodes: [
    {
      type: "base",
      slug: "products",
      name: "Products",
      description: "",
      position: 0,
      base: {
        slug: "products",
        name: "Products",
        description: "",
        fields: [
          { slug: "name", name: "Name", type: "text", required: true, position: 0, options: {} },
          {
            slug: "price",
            name: "Price",
            type: "number",
            required: false,
            position: 1,
            options: { number: { format: "currency", currency: "USD" } },
          },
        ],
        views: [],
      },
      records: [],
    },
    {
      type: "base",
      slug: "orders",
      name: "Orders",
      description: "",
      position: 1,
      base: {
        slug: "orders",
        name: "Orders",
        description: "",
        fields: [
          { slug: "ref", name: "Ref", type: "text", required: true, position: 0, options: {} },
          {
            slug: "items",
            name: "Items",
            type: "relation",
            required: false,
            position: 1,
            options: { targetBaseSlug: "products", multiple: true },
          },
          {
            slug: "order_total",
            name: "Order Total",
            type: "lookup",
            required: false,
            position: 2,
            options: {
              lookup: {
                relationFieldSlug: "items",
                targetFieldSlug: "price",
                rollup: "sum",
              },
              number: { format: "currency", currency: "USD" },
            },
          },
        ],
        views: [],
      },
      records: [],
    },
  ],
});

describe("lookup fields survive the package export/install round trip", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: PackageClient;

  const inSpace = <T>(spaceId: string, fn: () => Promise<T>): Promise<T> =>
    runWithBusabaseContext({ spaceId }, fn);

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-lookup-pkg-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-lookup-pkg-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  // Guard (1) at the schema level — this is the failure that leaves no trace.
  it("keeps options.lookup through the package options schema instead of stripping it", () => {
    const parsed = PackageFieldOptionsSchema.parse({
      lookup: { relationFieldSlug: "items", targetFieldSlug: "price", rollup: "sum" },
      number: { format: "currency", currency: "USD" },
    });
    expect(parsed.lookup).toEqual({
      relationFieldSlug: "items",
      targetFieldSlug: "price",
      rollup: "sum",
    });
    expect(parsed.number?.currency).toBe("USD");
  });

  // Guards (2) and (3) at the declaration level, before the slow install below.
  it("classifies lookup as both deferred and computed", () => {
    expect(PACKAGE_DEFERRED_FIELD_TYPES).toContain("lookup");
    expect(PACKAGE_COMPUTED_FIELD_TYPES).toContain("lookup");
  });

  it("installs a base whose lookup hops through a relation, config intact", async () => {
    const spaceId = "space_lookup_pkg";
    const tree = lookupTree("lookup-probe");

    // Round-trip every field through the package's own zod schema first — that
    // is what reading a package off disk does, and it is where an unlisted
    // option key gets silently dropped. Building the tree as a plain TS object
    // would skip the exact step this test needs to cover.
    const parsedTree: PackageTree = {
      ...tree,
      nodes: tree.nodes.map((node) =>
        node.type === "base"
          ? {
              ...node,
              base: {
                ...node.base,
                fields: node.base.fields.map((field) => PackageBaseFieldSchema.parse(field)),
              },
            }
          : node,
      ),
    };

    await inSpace(spaceId, async () => {
      const target = await resolveTargetState(client, parsedTree.manifest.name);
      const plan = buildInstallPlan(parsedTree, target);
      expect(plan.collisions).toEqual([]);
      // Would throw BAD_REQUEST ("must point at a relation field on this Base")
      // if lookup weren't deferred alongside the relation it hops through.
      return applyInstall(client, plan, { autoMerge: true });
    });

    const bases = await inSpace(spaceId, () => client.bases.list({}));
    const orders = bases.find((base) => base.slug === "orders");
    expect(orders).toBeTruthy();

    const lookupField = orders?.fields.find((field) => field.slug === "order_total");
    expect(lookupField?.type).toBe("lookup");
    expect(lookupField?.options.lookup).toEqual({
      relationFieldSlug: "items",
      targetFieldSlug: "price",
      rollup: "sum",
    });
    // The currency snapshot the client needs to render the rollup as money.
    expect(lookupField?.options.number).toEqual({ format: "currency", currency: "USD" });
  });
});
