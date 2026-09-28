import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BusabaseContext } from "../src/context";
import type { busabaseRouter } from "../src/router";

/**
 * Regression: on PGlite, merging a file-tree `update` that replaces a path's
 * bytes with a new Asset hung the server until restart.
 *
 * The replace runs inside the merge transaction and drops the now-unused
 * uploaded Asset (`deleteAssetRow(id, tx)`), which writes an `asset.deleted`
 * audit event through the tx. `insertAuditEvent` then resolved the actor's
 * user ref via the host's `resolveUsers` — and Busabase Cloud's resolver
 * queries through its own global db handle, not the tx. PGlite has a single
 * connection, so that query waited on the open transaction forever.
 *
 * Core's own tests inject no `resolveUsers` (the OSS path never queries), so
 * the hazard only shows with a host-shaped resolver: this one reads through
 * `getDb()` exactly like `resolveSpaceUserRefs` does in the Busabase Cloud app.
 * Every call below runs inside that context. Without the fix the merge never
 * returns; the short timeout makes that a fast failure instead of a hung CI.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("File-tree asset replace on PGlite with a DB-backed host user resolver", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let inHostContext: <T>(fn: () => Promise<T>) => Promise<T>;
  let resolverCalls = 0;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-asset-replace-resolver-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-asset-replace-resolver-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    const { busabaseRouter: router } = await import("../src/router");
    const { runWithBusabaseContext } = await import("../src/context");
    const { getDb } = await import("../src/db");
    const { busabaseAuditEvents } = await import("../src/db/schema");
    client = createRouterClient(router);

    const hostContext: BusabaseContext = {
      // Same shape as Busabase Cloud's `resolveSpaceUserRefs(db, …)`: a lookup
      // through the process-wide handle, never through a caller's transaction.
      resolveUsers: async (userIds) => {
        resolverCalls += 1;
        const db = await getDb();
        await db.select({ id: busabaseAuditEvents.id }).from(busabaseAuditEvents).limit(1);
        return new Map(
          userIds.map((userId) => [
            userId,
            { id: userId, name: "Host User", email: null, image: null, role: null },
          ]),
        );
      },
    };
    inHostContext = (fn) => runWithBusabaseContext(hostContext, fn);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const createAsset = async (input: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    contentHash: string;
  }) => {
    const request = await client.assets.createUploadUrl(input);
    const confirmed = await client.assets.confirm({ storageKey: request.storageKey, ...input });
    return confirmed.assetId as string;
  };

  it(
    "merges an asset-backed `update` and repoints the path at the new bytes",
    {
      timeout: 20_000,
    },
    async () => {
      const replacementHash = `sha256:${"2".repeat(64)}`;
      const { driveId, originalAssetId, replacementAssetId } = await inHostContext(async () => {
        const originalAssetId = await createAsset({
          fileName: "deck-v1.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          contentHash: `sha256:${"1".repeat(64)}`,
        });
        const drive = await client.fileTrees.create({
          type: "drive",
          autoMerge: true,
          slug: "host-resolver-replace-drive",
          name: "Host Resolver Replace Drive",
          files: [{ path: "deck.pdf", assetId: originalAssetId, displayName: "Deck v1" }],
        });
        if (!("node" in drive)) throw new Error("expected an immediate node (autoMerge: true)");
        const replacementAssetId = await createAsset({
          fileName: "deck-v2.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
          contentHash: replacementHash,
        });
        return { driveId: drive.node.id, originalAssetId, replacementAssetId };
      });

      // The call that used to hang: create + auto-merge in one request.
      const changeRequest = await inHostContext(() =>
        client.fileTrees.createChangeRequest({
          type: "drive",
          nodeId: driveId,
          autoMerge: true,
          operations: [
            {
              kind: "update",
              path: "deck.pdf",
              assetId: replacementAssetId,
              displayName: "Deck v2",
            },
          ],
        }),
      );
      expect(changeRequest.status).toBe("merged");

      const { file, asset, library } = await inHostContext(async () => ({
        file: await client.fileTrees.readFile({
          type: "drive",
          nodeId: driveId,
          filePath: "deck.pdf",
        }),
        asset: (await client.assets.get({ assetId: originalAssetId })).asset,
        library: await client.assets.list(),
      }));
      // Same Asset id at the path, now carrying the replacement's bytes.
      expect(file.assetId).toBe(originalAssetId);
      expect(file.displayName).toBe("Deck v2");
      expect(asset.contentHash).toBe(replacementHash);
      expect(asset.size).toBe(2048);
      // The uploaded Asset was cleaned up inside the merge (the audited delete).
      expect(library.some((entry) => entry.id === replacementAssetId)).toBe(false);
      // The host resolver really was in play for this run.
      expect(resolverCalls).toBeGreaterThan(0);
    },
  );
});
