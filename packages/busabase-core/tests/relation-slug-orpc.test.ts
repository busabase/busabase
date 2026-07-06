import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Relation fields can name their target Base by **slug** (`targetBaseSlug`) instead
 * of the raw `bse_...` id — resolved to `targetBaseId` on write, comprehensively,
 * across EVERY field-creation path: direct add-field, add-field CR (→ merge), field
 * options update CR (→ merge), create-base-with-fields, and node-CR base create
 * (→ merge). Exercised through the real oRPC router.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const findNode = (tree: Array<{ slug: string; children?: unknown[] }>, slug: string): any => {
  for (const node of tree) {
    if (node.slug === slug) return node;
    const nested = node.children ? findNode(node.children as typeof tree, slug) : undefined;
    if (nested) return nested;
  }
  return undefined;
};

describe("Relation field target by slug — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let companiesId = "";

  const optionsFor = async (baseId: string, fieldSlug: string) => {
    const base = await client.bases.get({ baseId });
    const field = base?.fields.find((f) => f.slug === fieldSlug);
    return field?.options as { targetBaseId?: string; targetBaseSlug?: string } | undefined;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-relslug-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-relslug-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    // The relation target every test points at.
    const companies = await client.bases.create({
      slug: "companies",
      name: "Companies",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
    });
    companiesId = companies.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  const approveMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({ changeRequestId, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId });
  };

  it("resolves the slug on a direct add-field (bases.createField)", async () => {
    const base = await client.bases.create({
      slug: "contacts-a",
      name: "Contacts A",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
    });
    await client.bases.createField({
      baseId: base.id,
      slug: "company",
      name: "Company",
      type: "relation",
      options: { targetBaseSlug: "companies" },
    });
    const opts = await optionsFor(base.id, "company");
    expect(opts?.targetBaseId).toBe(companiesId);
    expect(opts?.targetBaseSlug).toBeUndefined();
  });

  it("resolves the slug in create-base-with-fields (bases.create)", async () => {
    const base = await client.bases.create({
      slug: "contacts-b",
      name: "Contacts B",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        {
          slug: "company",
          name: "Company",
          type: "relation",
          required: false,
          options: { targetBaseSlug: "companies" },
        },
      ],
    });
    const opts = await optionsFor(base.id, "company");
    expect(opts?.targetBaseId).toBe(companiesId);
  });

  it("resolves the slug through an add-field ChangeRequest → merge", async () => {
    const base = await client.bases.create({
      slug: "contacts-c",
      name: "Contacts C",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
    });
    const cr = await client.bases.createFieldChangeRequest({
      baseId: base.id,
      slug: "company",
      name: "Company",
      type: "relation",
      options: { targetBaseSlug: "companies" },
    });
    await approveMerge(cr.id);
    const opts = await optionsFor(base.id, "company");
    expect(opts?.targetBaseId).toBe(companiesId);
    expect(opts?.targetBaseSlug).toBeUndefined();
  });

  it("resolves the slug through a field-options update ChangeRequest → merge", async () => {
    const base = await client.bases.create({
      slug: "contacts-d",
      name: "Contacts D",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        {
          slug: "company",
          name: "Company",
          type: "relation",
          required: false,
          options: { targetBaseId: companiesId },
        },
      ],
    });
    const field = (await client.bases.get({ baseId: base.id }))?.fields.find(
      (f) => f.slug === "company",
    );
    const cr = await client.bases.updateFieldChangeRequest({
      baseId: base.id,
      fieldId: field?.id as string,
      patch: { options: { targetBaseSlug: "companies" } },
    });
    await approveMerge(cr.id);
    const opts = await optionsFor(base.id, "company");
    expect(opts?.targetBaseId).toBe(companiesId);
  });

  it("resolves the slug in a node-CR base create → merge (materialize path)", async () => {
    const cr = await client.nodes.createChangeRequest({
      message: "Create a Deals base linked to Companies",
      operations: [
        {
          kind: "create",
          nodeType: "base",
          slug: "deals",
          name: "Deals",
          fields: [
            { slug: "title", name: "Title", type: "text", required: true },
            {
              slug: "company",
              name: "Company",
              type: "relation",
              options: { targetBaseSlug: "companies" },
            },
          ],
        },
      ],
    });
    await approveMerge(cr.id);
    const deals = findNode(
      (await client.nodes.list()) as Array<{ slug: string; children?: unknown[] }>,
      "deals",
    );
    const dealsBaseId = deals?.baseId as string;
    const opts = await optionsFor(dealsBaseId, "company");
    expect(opts?.targetBaseId).toBe(companiesId);
  });

  it("prefers an explicit targetBaseId when both are given, dropping the slug", async () => {
    const base = await client.bases.create({
      slug: "contacts-e",
      name: "Contacts E",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
    });
    await client.bases.createField({
      baseId: base.id,
      slug: "company",
      name: "Company",
      type: "relation",
      options: { targetBaseId: companiesId, targetBaseSlug: "does-not-exist" },
    });
    const opts = await optionsFor(base.id, "company");
    expect(opts?.targetBaseId).toBe(companiesId);
    expect(opts?.targetBaseSlug).toBeUndefined();
  });

  it("rejects an unknown target base slug", async () => {
    const base = await client.bases.create({
      slug: "contacts-f",
      name: "Contacts F",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
    });
    await expect(
      client.bases.createField({
        baseId: base.id,
        slug: "company",
        name: "Company",
        type: "relation",
        options: { targetBaseSlug: "no-such-base" },
      }),
    ).rejects.toThrow(/not found by slug/i);
  });
});
