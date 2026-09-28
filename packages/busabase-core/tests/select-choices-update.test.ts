import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * The field edit dialog saves a select field's choices as ONE update change
 * request carrying the whole list. These are the server behaviours it relies on:
 * a renamed / reordered choice keeps its id (so records keep their value), and a
 * choice still used by an active record cannot be dropped.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("select choices — update via the field edit path", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let statusFieldId = "";
  let recordId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-choices-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-choices-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });

    const base = await client.bases.create({
      autoMerge: true,
      slug: "choices-update-test",
      name: "Choices Update Test",
      fields: [
        { slug: "title", name: "Title", type: "text" },
        {
          slug: "status",
          name: "Status",
          type: "select",
          options: {
            choices: [
              { id: "opt_todo", name: "待办", color: "slate" },
              { id: "opt_doing", name: "进行中", color: "amber" },
              { id: "opt_done", name: "已完成", color: "emerald" },
            ],
          },
        },
      ],
    });
    baseId = base.id;
    statusFieldId = base.fields.find((field) => field.slug === "status")?.id ?? "";

    await client.bases.createChangeRequest({
      baseId,
      fields: { title: "uses doing", status: "opt_doing" },
      autoMerge: true,
    });
    const [record] = await client.records.search({
      baseId,
      fieldSlug: "title",
      valueText: "uses doing",
    });
    if (!record) throw new Error("seed record missing");
    recordId = record.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const statusChoices = async () => {
    const bases = await client.bases.list({});
    const field = bases
      .find((base) => base.id === baseId)
      ?.fields.find((item) => item.id === statusFieldId);
    return field?.options.choices ?? [];
  };

  const updateChoices = (
    choices: Array<{ id: string; name: string; color?: string }>,
    autoMerge: boolean,
  ) =>
    client.bases.fieldChangeRequest({
      operation: "update",
      baseId,
      fieldId: statusFieldId,
      patch: { name: "Status", options: { choices } },
      autoMerge,
    });

  it("renames, reorders and adds in one request; the record keeps its choice id", async () => {
    const result = await updateChoices(
      [
        { id: "opt_doing", name: "处理中", color: "amber" },
        { id: "opt_todo", name: "待办", color: "slate" },
        { id: "opt_done", name: "已完成", color: "emerald" },
        { id: "opt_blocked", name: "受阻", color: "rose" },
      ],
      true,
    );
    expect(result.status).toBe("merged");
    expect(await statusChoices()).toEqual([
      { id: "opt_doing", name: "处理中", color: "amber" },
      { id: "opt_todo", name: "待办", color: "slate" },
      { id: "opt_done", name: "已完成", color: "emerald" },
      { id: "opt_blocked", name: "受阻", color: "rose" },
    ]);
    const record = await client.records.get({ recordId });
    expect(record.headCommit.payload.status).toBe("opt_doing");
  });

  it("refuses to drop a choice an active record still uses, naming the ids", async () => {
    await expect(
      updateChoices(
        [
          { id: "opt_todo", name: "待办", color: "slate" },
          { id: "opt_done", name: "已完成", color: "emerald" },
        ],
        true,
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { removedChoiceIds: ["opt_doing", "opt_blocked"], affectedRecordIds: [recordId] },
    });
    expect((await statusChoices()).map((choice) => choice.id)).toContain("opt_doing");
  });

  it("drops an unused choice", async () => {
    const result = await updateChoices(
      [
        { id: "opt_doing", name: "处理中", color: "amber" },
        { id: "opt_todo", name: "待办", color: "slate" },
        { id: "opt_done", name: "已完成", color: "emerald" },
      ],
      true,
    );
    expect(result.status).toBe("merged");
    expect((await statusChoices()).map((choice) => choice.id)).toEqual([
      "opt_doing",
      "opt_todo",
      "opt_done",
    ]);
  });

  it("holds the same edit for review when auto-merge is not requested", async () => {
    const result = await updateChoices(
      [
        { id: "opt_doing", name: "处理中", color: "amber" },
        { id: "opt_todo", name: "待办", color: "slate" },
      ],
      false,
    );
    expect(result.status).toBe("in_review");
    expect((await statusChoices()).map((choice) => choice.id)).toContain("opt_done");
  });
});
