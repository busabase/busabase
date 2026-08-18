import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("record update permission-aware auto-merge", () => {
  let client: Client;
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-update-auto-merge-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-update-auto-merge-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "record-update-auto-merge",
      name: "Record Update Auto Merge",
      fields: [{ slug: "title", name: "Title", type: "text" }],
      autoMerge: true,
    });
    if ("materialized" in base && !base.materialized) {
      throw new Error("Expected a materialized Base");
    }
    baseId = base.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const createRecord = async (title: string) => {
    const result = await client.bases.createChangeRequest({
      baseId,
      fields: { title },
      autoMerge: true,
    });
    if (!result.materialized) throw new Error("Expected a materialized record");
    return result;
  };

  it("auto-merges an omitted autoMerge request for a manage-level non-manager context", async () => {
    const record = await createRecord("Manage default");

    const result = await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "manage-api-key-owner",
        isSpaceManager: false,
        permissionLevel: "manage",
      },
      () =>
        client.records.changeRequest({
          operation: "update",
          recordId: record.id,
          fields: { title: "Manage default updated" },
        }),
    );

    expect(result.materialized).toBe(true);
    if (!result.materialized) throw new Error("Expected a materialized record update");
    expect(result.headCommit.payload.title).toBe("Manage default updated");
  });

  it("preserves explicit autoMerge false as review-first for manage access", async () => {
    const record = await createRecord("Manage review-first");

    const result = await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "manage-api-key-owner",
        isSpaceManager: false,
        permissionLevel: "manage",
      },
      () =>
        client.records.changeRequest({
          operation: "update",
          recordId: record.id,
          fields: { title: "Pending manager update" },
          autoMerge: false,
        }),
    );

    expect(result.materialized).toBe(false);
    if (result.materialized) throw new Error("Expected a pending ChangeRequest");
    expect(result.status).toBe("in_review");
  });

  it("falls back to a pending ChangeRequest when autoMerge is requested without write access", async () => {
    const record = await createRecord("ChangeRequest fallback");

    const result = await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "change-request-api-key-owner",
        isSpaceManager: false,
        permissionLevel: "changeRequest",
      },
      () =>
        client.records.changeRequest({
          operation: "update",
          recordId: record.id,
          fields: { title: "Pending restricted update" },
          autoMerge: true,
        }),
    );

    expect(result.materialized).toBe(false);
    if (result.materialized) throw new Error("Expected a pending ChangeRequest");
    expect(result.status).toBe("in_review");
  });
});
