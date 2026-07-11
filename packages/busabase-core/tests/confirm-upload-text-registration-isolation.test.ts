import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

/**
 * Regression coverage: `confirmAssetUpload`'s Drive Grep Retrieval
 * auto-registration call (`autoRegisterAssetText`) used to sit inside the
 * SAME try/catch whose catch rethrows as a fatal upload error — so any
 * transient failure in text bookkeeping (e.g. the text table briefly
 * unavailable) failed the ENTIRE upload confirm, even for a plain binary
 * file (PNG) that has nothing to do with text.
 *
 * `autoRegisterAssetText` is mocked to always throw here, simulating exactly
 * that failure mode, and asserts `confirmAssetUpload` still succeeds.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const HASH = (byte: string) => `sha256:${byte.repeat(64)}`;

vi.mock("../src/domains/assets/logic/asset-texts-logic", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/domains/assets/logic/asset-texts-logic")>();
  return {
    ...actual,
    autoRegisterAssetText: vi.fn(async () => {
      throw new Error("simulated text-registration failure (text table briefly unavailable)");
    }),
  };
});

describe("confirmAssetUpload — text auto-registration failure is isolated", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-confirm-isolation-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-confirm-isolation-storage-"));
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

  it("still confirms a plain binary (PNG) upload even though text auto-registration throws", async () => {
    const contentHash = HASH("9");
    const req = await client.assets.createUploadUrl({
      fileName: "photo.png",
      mimeType: "image/png",
      sizeBytes: 100,
      contentHash,
    });

    const confirmed = await client.assets.confirm({
      storageKey: req.storageKey,
      fileName: "photo.png",
      mimeType: "image/png",
      sizeBytes: 100,
      contentHash,
    });

    expect(confirmed.assetId).toBeDefined();
    expect(confirmed.success).toBe(true);
  });
});
