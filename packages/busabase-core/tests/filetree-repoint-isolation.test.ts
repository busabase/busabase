import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { busabaseRouter } from "../src/router";

/**
 * Regression coverage: the Drive Grep Retrieval staleness hook
 * (`handleAssetAttachmentRepoint`) used to be awaited directly on the SAME
 * database transaction as the file-tree replace it's a side effect of, with
 * no error isolation — an unrelated failure inside it (e.g. a
 * `busabase_asset_texts` table problem) would abort the WHOLE transaction,
 * discarding the user's legitimate, unrelated file replacement.
 *
 * `handleAssetAttachmentRepoint` is mocked to always throw here; the test
 * asserts the underlying file replace still commits successfully.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

vi.mock("../src/domains/assets/logic/asset-texts-logic", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/domains/assets/logic/asset-texts-logic")>();
  return {
    ...actual,
    handleAssetAttachmentRepoint: vi.fn(async () => {
      throw new Error("simulated text-bookkeeping failure (unrelated to the file replace)");
    }),
  };
});

describe("File-tree replace — text-staleness hook failure is isolated from the transaction", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-repoint-isolation-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-repoint-isolation-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    const { busabaseRouter: router } = await import("../src/router");
    client = createRouterClient(router);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("still commits a valid file replace even though handleAssetAttachmentRepoint throws", async () => {
    const drive = await client.drives.create({
      autoMerge: true,
      slug: "repoint-hook-isolation-drive",
      name: "Repoint Hook Isolation Drive",
      files: [{ path: "notes.md", content: "revision one" }],
    });
    if (!("node" in drive)) throw new Error("expected an immediate node (autoMerge: true)");

    const cr = await client.drives.createChangeRequest({
      nodeId: drive.node.id,
      operations: [
        { kind: "update", path: "notes.md", content: "revision two — the real replace" },
      ],
      message: "Replace notes",
      submittedBy: "agent",
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });

    // The merge must NOT throw — a failure inside the (mocked-to-throw)
    // staleness hook must never abort this otherwise-valid file replace. If
    // it did, this `await` would reject and fail the test.
    await client.changeRequests.merge({ changeRequestId: cr.id });

    const file = await client.drives.readFile({ nodeId: drive.node.id, filePath: "notes.md" });
    expect(file.content).toBe("revision two — the real replace");
  });
});
