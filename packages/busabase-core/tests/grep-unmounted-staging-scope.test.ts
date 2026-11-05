import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import { loadAssetTextRows } from "../src/domains/assets/logic/asset-texts-logic";
import { busabaseRouter } from "../src/router";

/**
 * Unscoped grep vs unmounted staging uploads.
 *
 * Every retried or abandoned upload leaves an asset that no node references.
 * A migrated space held 100k+ of them, and a manager's unscoped grep used to
 * pull every one in as a candidate: past 65,534 ids the single `inArray`
 * statement exceeded Postgres' bind-parameter limit and grep answered 500,
 * and below it `missing` listed tens of thousands of orphans nobody owns.
 *
 * Pinned here: an unscoped grep covers files on nodes plus the caller's own
 * staging uploads; someone else's staging upload is reachable only by naming
 * it in `assetIds`; and the id lookups are batched so no statement can exceed
 * the limit.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const HASH = (byte: string) => `sha256:${byte.repeat(64)}`;

const asManager = <T>(actorId: string, fn: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, actorId, isSpaceManager: true }, fn);

describe("grep — unmounted staging uploads in an unscoped search", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let aliceStaged = "";
  let bobStaged = "";
  let aliceStagedNoText = "";
  let bobStagedNoText = "";
  let mountedNoText = "";

  const upload = (actorId: string, fileName: string, mimeType: string, hashByte: string) =>
    asManager(actorId, async () => {
      const body = Buffer.from(`${fileName} bytes`, "utf8");
      const contentHash = HASH(hashByte);
      const req = await client.assets.createUploadUrl({
        fileName,
        mimeType,
        sizeBytes: body.byteLength,
        contentHash,
      });
      await storage.uploadFileToKey(body, req.storageKey, mimeType);
      const confirmed = await client.assets.confirm({
        storageKey: req.storageKey,
        fileName,
        mimeType,
        sizeBytes: body.byteLength,
        contentHash,
      });
      if (!confirmed.assetId) throw new Error("Expected an assetId");
      return confirmed.assetId;
    });

  const stageWithText = async (
    actorId: string,
    fileName: string,
    hashByte: string,
    text: string,
  ) => {
    const assetId = await upload(actorId, fileName, "application/pdf", hashByte);
    await asManager(actorId, () => client.assets.putText({ assetId, text }));
    return assetId;
  };

  const grep = (input: Parameters<Client["grep"]>[0]) =>
    asManager("alice", () => client.grep(input));

  const fileHits = (result: Awaited<ReturnType<Client["grep"]>>) =>
    result.matches.flatMap((match) => (match.source === "files" ? [match.assetId] : []));

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-staging-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-staging-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    aliceStaged = await stageWithText("alice", "alice-draft.pdf", "a", "STAGEDMARKER alice");
    bobStaged = await stageWithText("bob", "bob-draft.pdf", "b", "STAGEDMARKER bob");
    aliceStagedNoText = await upload("alice", "alice-orphan.pdf", "application/pdf", "c");
    bobStagedNoText = await upload("bob", "bob-orphan.pdf", "application/pdf", "d");

    mountedNoText = await upload("bob", "contract.pdf", "application/pdf", "e");
    await asManager("bob", async () => {
      const cr = await client.nodes.createChangeRequest({
        operations: [
          {
            kind: "create",
            nodeType: "file",
            slug: "contract",
            name: "Contract",
            description: "",
            metadata: { assetId: mountedNoText },
          },
        ],
      });
      await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
      await client.changeRequests.merge({ changeRequestIds: [cr.id] });
    });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("searches the manager's own staging uploads but not other people's", async () => {
    const hits = fileHits(await grep({ pattern: "STAGEDMARKER", sources: ["files"] }));
    expect(hits).toContain(aliceStaged);
    expect(hits).not.toContain(bobStaged);
  });

  it("lists only files on a node as missing text", async () => {
    const { missing } = (await grep({ pattern: "anything", sources: ["files"] })).coverage.files;
    expect(missing).toContain(mountedNoText);
    expect(missing).not.toContain(aliceStagedNoText);
    expect(missing).not.toContain(bobStagedNoText);
  });

  it("still reaches someone else's staging upload when it is named", async () => {
    const result = await grep({
      pattern: "STAGEDMARKER",
      sources: ["files"],
      scope: { files: { assetIds: [bobStaged, bobStagedNoText] } },
    });
    expect(fileHits(result)).toEqual([bobStaged]);
    expect(result.coverage.files.missing).toEqual([bobStagedNoText]);
  });

  it("loads text rows for more ids than one statement can bind", async () => {
    const ids = Array.from({ length: 70_000 }, (_, i) => `ast_absent_${i}`);
    ids.push(aliceStaged);
    const rows = await loadAssetTextRows(await getDb(), ids);
    expect([...rows.keys()]).toEqual([aliceStaged]);
  });
});
