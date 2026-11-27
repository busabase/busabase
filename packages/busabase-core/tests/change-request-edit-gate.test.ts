import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Proposing a change to a Base — its records, fields, views, or the Base
 * itself — needs `changeRequest` on the Base's node, the level the API-key
 * policy table declares for every one of these endpoints. That table only
 * gates API keys; a web session is held to it by the handlers alone, and the
 * delete/restore, field, view and Base-lifecycle creators had no check, so a
 * read-only member could queue pending change requests (and their review
 * notifications) for anything they could see.
 */
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const as = <T>(actorId: string, permissionLevel: "read" | "changeRequest", fn: () => Promise<T>) =>
  runWithBusabaseContext(
    { spaceId: LOCAL_SPACE_ID, actorId, isSpaceManager: false, permissionLevel },
    fn,
  );

describe("proposing a change to a Base needs changeRequest access", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let fieldIds: Record<string, string> = {};
  let viewId = "";
  let activeRecordId = "";
  let archivedRecordId = "";
  let deletedFieldId = "";
  let archivedViewId = "";
  let archivedBaseId = "";

  const pendingCount = async () =>
    (await client.changeRequests.list({ status: ["in_review"] })).length;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-gate-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-gate-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });

    const base = await client.bases.create({
      slug: "edit-gate",
      name: "Edit Gate",
      fields: [
        { slug: "name", name: "Name", type: "text" },
        { slug: "notes", name: "Notes", type: "text" },
        { slug: "spare", name: "Spare", type: "text" },
      ],
      autoMerge: true,
    });
    if ("status" in base) throw new Error("Expected materialized BaseVO");
    baseId = base.id;
    fieldIds = Object.fromEntries(base.fields.map((field) => [field.slug, field.id]));
    const record = async (name: string) => {
      const created = await client.bases.createChangeRequest({
        baseId,
        fields: { name },
        autoMerge: true,
      });
      if (!("materialized" in created) || !created.materialized)
        throw new Error("Expected a record");
      return created.id;
    };
    activeRecordId = await record("Active");
    archivedRecordId = await record("Archived");
    await client.records.changeRequest({
      operation: "delete",
      recordId: archivedRecordId,
      autoMerge: true,
    });
    await client.bases.fieldChangeRequest({
      baseId,
      operation: "delete",
      fieldId: fieldIds.spare ?? "",
      autoMerge: true,
    });
    deletedFieldId = fieldIds.spare ?? "";
    const view = await client.views.changeRequest({
      operation: "create",
      baseId,
      slug: "gate-view",
      name: "Gate view",
      type: "table",
      autoMerge: true,
    });
    if (!("materialized" in view) || !view.materialized) throw new Error("Expected a view");
    viewId = view.id;
    const archivedView = await client.views.changeRequest({
      operation: "create",
      baseId,
      slug: "gate-archived-view",
      name: "Archived view",
      type: "table",
      autoMerge: true,
    });
    if (!("materialized" in archivedView) || !archivedView.materialized)
      throw new Error("Expected a view");
    archivedViewId = archivedView.id;
    await client.views.changeRequest({
      operation: "delete",
      viewId: archivedViewId,
      autoMerge: true,
    });
    const second = await client.bases.create({
      slug: "edit-gate-archived",
      name: "Edit Gate Archived",
      fields: [{ slug: "name", name: "Name", type: "text" }],
      autoMerge: true,
    });
    if ("status" in second) throw new Error("Expected materialized BaseVO");
    archivedBaseId = second.id;
    await client.bases.lifecycleChangeRequest({
      baseId: archivedBaseId,
      operation: "archive",
      autoMerge: true,
    });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  // Every proposal a Base accepts, as a thunk so each runs in the caller's context.
  const proposals = (): Array<[string, () => Promise<unknown>]> => [
    [
      "record delete",
      () => client.records.changeRequest({ operation: "delete", recordId: activeRecordId }),
    ],
    [
      "record restore",
      () => client.records.changeRequest({ operation: "restore", recordId: archivedRecordId }),
    ],
    [
      "field create",
      () =>
        client.bases.fieldChangeRequest({
          baseId,
          operation: "create",
          slug: "extra",
          name: "Extra",
          type: "text",
        }),
    ],
    [
      "field update",
      () =>
        client.bases.fieldChangeRequest({
          baseId,
          operation: "update",
          fieldId: fieldIds.notes ?? "",
          patch: { name: "Remarks" },
        }),
    ],
    [
      "field delete",
      () =>
        client.bases.fieldChangeRequest({
          baseId,
          operation: "delete",
          fieldId: fieldIds.notes ?? "",
        }),
    ],
    [
      "field convert",
      () =>
        client.bases.fieldChangeRequest({
          baseId,
          operation: "convert",
          fieldId: fieldIds.notes ?? "",
          newType: "longtext",
        }),
    ],
    [
      "field reorder",
      () =>
        client.bases.fieldChangeRequest({
          baseId,
          operation: "reorder",
          fieldIds: [fieldIds.notes ?? "", fieldIds.name ?? ""],
        }),
    ],
    [
      "field restore",
      () =>
        client.bases.fieldChangeRequest({ baseId, operation: "restore", fieldId: deletedFieldId }),
    ],
    [
      "view create",
      () =>
        client.views.changeRequest({
          operation: "create",
          baseId,
          slug: "proposed-view",
          name: "Proposed",
          type: "table",
        }),
    ],
    [
      "view update",
      () => client.views.changeRequest({ operation: "update", viewId, name: "Renamed view" }),
    ],
    ["view delete", () => client.views.changeRequest({ operation: "delete", viewId })],
    [
      "view restore",
      () => client.views.changeRequest({ operation: "restore", viewId: archivedViewId }),
    ],
    ["base archive", () => client.bases.lifecycleChangeRequest({ baseId, operation: "archive" })],
    [
      "base restore",
      () => client.bases.lifecycleChangeRequest({ baseId: archivedBaseId, operation: "restore" }),
    ],
  ];

  it("refuses every proposal from a read-only member and queues nothing", async () => {
    const before = await pendingCount();
    const outcomes: Record<string, string> = {};
    await as("vera-viewer", "read", async () => {
      for (const [label, propose] of proposals()) {
        try {
          await propose();
          outcomes[label] = "accepted";
        } catch (error) {
          outcomes[label] = (error as { code?: string }).code ?? "error";
        }
      }
    });
    expect(outcomes).toEqual(
      Object.fromEntries(proposals().map(([label]) => [label, "FORBIDDEN"])),
    );
    expect(await pendingCount()).toBe(before);
  });

  it("still lets a changeRequest-level member propose each of them, for review", async () => {
    const outcomes: Record<string, string> = {};
    await as("pat-proposer", "changeRequest", async () => {
      for (const [label, propose] of proposals()) {
        try {
          const result = (await propose()) as { materialized?: boolean; status?: string };
          outcomes[label] =
            result.materialized === false || result.status === "in_review" ? "pending" : "merged";
        } catch (error) {
          outcomes[label] = `${(error as { code?: string }).code}: ${(error as Error).message}`;
        }
      }
    });
    expect(outcomes).toEqual(Object.fromEntries(proposals().map(([label]) => [label, "pending"])));
  });
});
