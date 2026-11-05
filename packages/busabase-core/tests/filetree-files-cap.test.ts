import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContextSpaceId } from "../src/context";
import { getDb } from "../src/db";
import { attachments } from "../src/db/schema";
import { resolveAgentContextResources } from "../src/domains/agents/logic/agent-context-resources";
import { busabaseAssets, busabaseAssetUsages } from "../src/domains/assets/schema/assets";
import {
  FILE_TREE_FILE_PAGE_MAX,
  FILE_TREE_INLINE_FILE_LIMIT,
} from "../src/domains/filetree/handlers";
import { busabaseRouter } from "../src/router";

/**
 * Behaviour that only exists above the real caps: the detail's inline limit
 * (`FILE_TREE_INLINE_FILE_LIMIT`) and the page ceiling (`FILE_TREE_FILE_PAGE_MAX`).
 *
 * The truncation probe asks for `inline limit + 1` rows; if the page ceiling were
 * ever applied inside the shared query helper at or below that, the probe would
 * never see its extra row and a big node would report itself complete — with the
 * files behind the cap unreachable. That needs a real oversized fixture. The usage rows are inserted directly — the real write path would cost
 * ~2 minutes of storage I/O to produce the same rows.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const EXTRA_FILES = FILE_TREE_INLINE_FILE_LIMIT + 1;

describe("a node past the inline limit", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let nodeId = "";
  let entryPagedOutNodeId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-files-cap-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-files-cap-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const drive = await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      mergeMode: "replace",
      slug: "capped-drive",
      name: "Capped Drive",
      files: [{ path: "zzz-last.md", content: "# last\n" }],
    } as never);
    if (!("node" in drive)) throw new Error("expected an immediate node (autoMerge: true)");
    nodeId = drive.node.id;

    const db = await getDb();
    const spaceId = getContextSpaceId();
    // One physical attachment stands in for every fixture file; the detail's
    // joins only need `attachments` to resolve, and its bytes are never read.
    await db.insert(attachments).values({
      id: "att-capped",
      storageKey: "attachments/test/capped.md",
      fileName: "capped.md",
      mimeType: "text/markdown",
      sizeBytes: 7,
      userId: "local-producer",
      spaceId,
    });
    // `bulk/...` sorts before `zzz-last.md`, so the seeded real file stays last.
    for (let start = 0; start < EXTRA_FILES; start += 500) {
      const slice = Array.from(
        { length: Math.min(500, EXTRA_FILES - start) },
        (_, index) => start + index,
      );
      await db.insert(busabaseAssets).values(
        slice.map((index) => ({
          id: `asset-capped-${index}`,
          spaceId,
          attachmentId: "att-capped",
          name: `capped-${index}.md`,
          contentKind: "text" as const,
        })),
      );
      await db.insert(busabaseAssetUsages).values(
        slice.map((index) => ({
          id: `usage-capped-${index}`,
          spaceId,
          assetId: `asset-capped-${index}`,
          ownerType: "drive" as const,
          nodeId,
          path: `bulk/${String(index).padStart(5, "0")}.md`,
        })),
      );
    }

    // A Drive whose entry file (`README.md`) really exists but sorts behind the
    // inline cap, which is the case the paged-out entry read exists for.
    const entryDrive = await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      mergeMode: "replace",
      slug: "capped-entry-drive",
      name: "Capped Entry Drive",
    } as never);
    if (!("node" in entryDrive)) throw new Error("expected an immediate node");
    entryPagedOutNodeId = entryDrive.node.id;
    // `A/...` sorts before `README.md`; a full page ceiling of them pushes the
    // entry past both the inline list and the first unpaged page.
    await seedUsageRows(entryPagedOutNodeId, "A", FILE_TREE_FILE_PAGE_MAX);
  });

  const seedUsageRows = async (targetNodeId: string, prefix: string, count: number) => {
    const db = await getDb();
    const spaceId = getContextSpaceId();
    for (let start = 0; start < count; start += 500) {
      const slice = Array.from(
        { length: Math.min(500, count - start) },
        (_, index) => start + index,
      );
      await db.insert(busabaseAssets).values(
        slice.map((index) => ({
          id: `asset-${prefix}-${index}`,
          spaceId,
          attachmentId: "att-capped",
          name: `capped-${prefix}-${index}.md`,
          contentKind: "text" as const,
        })),
      );
      await db.insert(busabaseAssetUsages).values(
        slice.map((index) => ({
          id: `usage-${prefix}-${index}`,
          spaceId,
          assetId: `asset-${prefix}-${index}`,
          ownerType: "drive" as const,
          nodeId: targetNodeId,
          path: `${prefix}/${String(index).padStart(5, "0")}.md`,
        })),
      );
    }
  };

  afterAll(async () => {
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
    process.chdir(originalCwd);
  });

  it("says it is truncated and quotes the real total, not the page size", async () => {
    const detail = await client.nodes.get({ nodeId, type: "drive" });
    if (!("files" in detail)) throw new Error("expected a file-tree detail");
    expect(detail.files).toHaveLength(FILE_TREE_INLINE_FILE_LIMIT);
    expect(detail.filesTruncated).toBe(true);
    // The cap bounds the response; it is not a claim about the node.
    expect(detail.fileCount).toBe(EXTRA_FILES + 1);
  });

  it("leaves nothing unreachable behind the cap", async () => {
    const detail = await client.nodes.get({ nodeId, type: "drive" });
    if (!("files" in detail)) throw new Error("expected a file-tree detail");
    const rest = await client.fileTrees.listFiles({
      nodeId,
      type: "drive",
      limit: 5_000,
      after: detail.files.at(-1)?.path,
    });
    const last = String(FILE_TREE_INLINE_FILE_LIMIT).padStart(5, "0");
    expect(rest.map((file) => file.path)).toEqual([`bulk/${last}.md`, "zzz-last.md"]);
  });

  it("hands an agent the entry file even when it sorts behind the cap", async () => {
    const detail = await client.nodes.get({ nodeId: entryPagedOutNodeId, type: "drive" });
    if (!("files" in detail)) throw new Error("expected a file-tree detail");
    expect(detail.entryFile).toBe("README.md");
    expect(detail.filesTruncated).toBe(true);
    // The listing really does not carry it...
    expect(detail.files.some((file) => file.path === "README.md")).toBe(false);

    // ...and the agent still gets it, read by path instead of out of the page.
    const resources = await resolveAgentContextResources([
      { nodeId: entryPagedOutNodeId, kind: "reference" },
    ]);
    const resource = resources.find((item) => item.nodeId === entryPagedOutNodeId);
    if (!resource) throw new Error("expected a context resource for the drive");
    expect(resource.text).toContain("## Entry file: README.md");
    expect(resource.text).not.toContain("## Entry file: README.md\n[");
    const listing = resource.text.split("## Files\n")[1]?.split("## Entry file:")[0] ?? "";
    expect(listing).not.toContain("README.md");
  });

  /**
   * Production had an API consumer pulling a 46k-file Drive on a timer with no
   * `limit`: ~5 s of database time and 46k joined rows per call. Capping the
   * detail alone would only move that load, so silence about the page size
   * means "first page".
   */
  it("caps a listing that asks for no page, and the ceiling continues cleanly", async () => {
    const detail = await client.nodes.get({ nodeId: entryPagedOutNodeId, type: "drive" });
    if (!("files" in detail)) throw new Error("expected a file-tree detail");
    expect(detail.fileCount).toBe(FILE_TREE_FILE_PAGE_MAX + 1);

    const unpaged = await client.fileTrees.listFiles({
      nodeId: entryPagedOutNodeId,
      type: "drive",
    });
    expect(unpaged).toHaveLength(FILE_TREE_FILE_PAGE_MAX);

    // The default page is the FIRST page, not an arbitrary slice: following
    // the cursor from its end reaches the rest with no gap and no repeat.
    const next = await client.fileTrees.listFiles({
      nodeId: entryPagedOutNodeId,
      type: "drive",
      after: unpaged.at(-1)?.path,
    });
    expect(next.map((file) => file.path)).toEqual(["README.md"]);
  });

  it("does not invent an entry file that the node no longer has", async () => {
    // This fixture's entry path is stale: the Drive was replaced after seeding,
    // so `entryFile` names a file that is neither in the page nor on disk. A
    // reference must lose the section, not fail outright.
    const resources = await resolveAgentContextResources([{ nodeId, kind: "reference" }]);
    const resource = resources.find((item) => item.nodeId === nodeId);
    if (!resource) throw new Error("expected a context resource for the drive");
    expect(resource.text).not.toContain("## Entry file:");
    expect(resource.text).toContain("## Files");
  });
});
