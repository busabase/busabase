import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * `options.multiple` decides whether a relation cell holds one record id or a list, and
 * nothing outside the relation editor reads it. Because the field `options` bag is shared
 * across every field type, a `select` used to accept it, persist it, and ignore it — the
 * schema read as multi-valued and the mistake only surfaced at the first record write, as
 * `must be one of its options`. These tests pin the guard that now rejects it up front, on
 * every path that defines a field.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const CHOICES = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
];

describe("field options — `multiple` is relation-only", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-fieldopts-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-fieldopts-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "opts",
      name: "Opts",
      fields: [{ slug: "title", name: "Title", type: "text", required: true, options: {} }],
      autoMerge: true,
    });
    baseId = base.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects `multiple` on a select created through bases.create", async () => {
    await expect(
      client.bases.create({
        slug: "opts-inline",
        name: "Opts inline",
        fields: [
          { slug: "title", name: "Title", type: "text", required: true, options: {} },
          {
            slug: "platforms",
            name: "Platforms",
            type: "select",
            required: false,
            options: { choices: CHOICES, multiple: true },
          },
        ],
        autoMerge: true,
      }),
    ).rejects.toThrow(/multiselect/);
  });

  it("rejects `multiple` on a select added through createField", async () => {
    await expect(
      client.bases.createField({
        baseId,
        slug: "platforms",
        name: "Platforms",
        type: "select",
        required: false,
        options: { choices: CHOICES, multiple: true },
      }),
    ).rejects.toThrow(/only applies to relation fields/);
  });

  it("rejects `multiple: false` too — the key is meaningless either way", async () => {
    await expect(
      client.bases.createField({
        baseId,
        slug: "platforms-single",
        name: "Platforms single",
        type: "select",
        required: false,
        options: { choices: CHOICES, multiple: false },
      }),
    ).rejects.toThrow(/only applies to relation fields/);
  });

  it("still accepts `multiple` on a relation field", async () => {
    const target = await client.bases.create({
      slug: "opts-target",
      name: "Opts target",
      fields: [{ slug: "title", name: "Title", type: "text", required: true, options: {} }],
      autoMerge: true,
    });
    const field = await client.bases.createField({
      baseId,
      slug: "links",
      name: "Links",
      type: "relation",
      required: false,
      options: { targetBaseId: target.id, multiple: true },
    });
    const created = field.fields.find((f) => f.slug === "links");
    expect(created?.type).toBe("relation");
    expect(created?.options?.multiple).toBe(true);
  });

  it("accepts a select whose options carry no `multiple`", async () => {
    const field = await client.bases.createField({
      baseId,
      slug: "status",
      name: "Status",
      type: "select",
      required: false,
      options: { choices: CHOICES },
    });
    expect(field.fields.find((f) => f.slug === "status")?.type).toBe("select");
  });
});
