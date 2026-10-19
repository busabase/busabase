import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * `bases.list` (live and archived) attach each Base's fields from ONE query
 * scoped to the listed Bases, grouped by `baseId` — instead of reading every
 * field in the space and re-filtering it per Base. This pins the grouping:
 * every Base gets exactly its own live fields, in position order, and a
 * deleted field or another Base's field never shows up on it.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("bases.list field grouping", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-base-list-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-base-list-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const land = async (changeRequest: { id: string; status: string }) => {
    if (changeRequest.status === "merged") return;
    await client.changeRequests.review({
      changeRequestIds: [changeRequest.id],
      verdict: "approved",
    });
    const [result] = (await client.changeRequests.merge({ changeRequestIds: [changeRequest.id] }))
      .results;
    if (!result?.ok) throw new Error(`merge failed: ${JSON.stringify(result)}`);
  };

  const fieldSlugs = (base: { fields: Array<{ slug: string }> } | undefined) =>
    base?.fields.map((field) => field.slug);

  it("gives each live and archived Base exactly its own live fields, in position order", async () => {
    // Nothing archived yet: the empty-ids short-circuit answers [] rather than
    // running an `IN ()` query.
    expect(await client.bases.list({ status: "archived" })).toEqual([]);

    const contacts = await client.bases.create({
      slug: "group-contacts",
      name: "Contacts",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "email", name: "Email", type: "text", options: {} },
        { slug: "notes", name: "Notes", type: "longtext", options: {} },
      ],
    });
    const deals = await client.bases.create({
      slug: "group-deals",
      name: "Deals",
      autoMerge: true,
      fields: [
        { slug: "title", name: "Title", type: "text", required: true, options: {} },
        { slug: "amount", name: "Amount", type: "number", options: {} },
      ],
    });
    const archived = await client.bases.create({
      slug: "group-archived",
      name: "Old leads",
      autoMerge: true,
      fields: [
        { slug: "lead", name: "Lead", type: "text", required: true, options: {} },
        { slug: "source", name: "Source", type: "text", options: {} },
      ],
    });

    // Reorder Contacts so position order differs from creation order, and
    // delete one of its fields so a soft-deleted row sits among the live ones.
    const [name, email, notes] = contacts.fields;
    if (!name || !email || !notes) throw new Error("Expected three Contacts fields");
    await land(
      await client.bases.fieldChangeRequest({
        operation: "reorder",
        baseId: contacts.id,
        fieldIds: [name.id, notes.id, email.id],
      }),
    );
    await land(
      await client.bases.fieldChangeRequest({
        operation: "delete",
        baseId: contacts.id,
        fieldId: email.id,
      }),
    );
    await land(
      await client.bases.lifecycleChangeRequest({ operation: "archive", baseId: archived.id }),
    );

    const live = await client.bases.list({});
    expect(fieldSlugs(live.find((base) => base.id === contacts.id))).toEqual(["name", "notes"]);
    expect(fieldSlugs(live.find((base) => base.id === deals.id))).toEqual(["title", "amount"]);
    expect(live.some((base) => base.id === archived.id)).toBe(false);

    const trash = await client.bases.list({ status: "archived" });
    expect(trash.map((base) => base.id)).toEqual([archived.id]);
    expect(fieldSlugs(trash[0])).toEqual(["lead", "source"]);
  });
  it('returns only relation and lookup fields with `fields: "links"`, and everything by default', async () => {
    const people = await client.bases.create({
      slug: "links-people",
      name: "People",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "email", name: "Email", type: "text", options: {} },
      ],
    });
    const tasks = await client.bases.create({
      slug: "links-tasks",
      name: "Tasks",
      autoMerge: true,
      fields: [
        { slug: "title", name: "Title", type: "text", required: true, options: {} },
        { slug: "points", name: "Points", type: "number", options: {} },
        {
          slug: "owner",
          name: "Owner",
          type: "relation",
          options: { targetBaseSlug: "links-people", multiple: false },
        },
        {
          slug: "owner_name",
          name: "Owner name",
          type: "lookup",
          options: { lookup: { relationFieldSlug: "owner", targetFieldSlug: "name" } },
        },
      ],
    });

    const links = await client.bases.list({ fields: "links" });
    expect(fieldSlugs(links.find((base) => base.id === tasks.id))).toEqual(["owner", "owner_name"]);
    // A Base with no links is still listed, with no fields, so a relation
    // picker can offer it as a target.
    expect(fieldSlugs(links.find((base) => base.id === people.id))).toEqual([]);

    const all = await client.bases.list({});
    expect(fieldSlugs(all.find((base) => base.id === tasks.id))).toEqual([
      "title",
      "points",
      "owner",
      "owner_name",
    ]);
    expect(links.map((base) => base.id).sort()).toEqual(all.map((base) => base.id).sort());
  });
});
