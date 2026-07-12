import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * `assets.editContent` — string-replace edits to an asset's REAL mounted
 * Drive/Skill file content, via the EXISTING filetree ChangeRequest pipeline.
 * Driven through the real oRPC router (mirrors `drive-grep-retrieval.test.ts` /
 * `drives-orpc.test.ts`'s harness), including a real review + merge round trip,
 * so these tests prove the full pipeline actually mutates the merged file —
 * not just that a ChangeRequest object gets constructed.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const HASH = (byte: string) => `sha256:${byte.repeat(64)}`;

const expectDefined = <T>(value: T | undefined | null): T => {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
  if (value === undefined || value === null) throw new Error("Expected value to be defined");
  return value;
};

describe("assets.editContent — string-replace edits via ChangeRequest", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-edit-content-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-edit-content-storage-"));
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

  const approveAndMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({ changeRequestId, verdict: "approved" });
    return client.changeRequests.merge({ changeRequestId });
  };

  /** Creates a Drive (autoMerge: true) with one text file, returns its mounted assetId. */
  const createMountedDriveFile = async (opts: { slug: string; path: string; content: string }) => {
    const drive = await client.drives.create({
      autoMerge: true,
      slug: opts.slug,
      name: opts.slug,
      files: [{ path: opts.path, content: opts.content }],
    });
    if (!("node" in drive)) throw new Error("expected an immediate node (autoMerge: true)");
    const assetId = expectDefined(drive.files.find((f) => f.path === opts.path)).assetId;
    return { drive, assetId };
  };

  describe("happy path", () => {
    it("full pipeline: creates an in_review CR, and merging it really changes the Drive file", async () => {
      const { drive, assetId } = await createMountedDriveFile({
        slug: "edit-content-happy-drive",
        path: "notes.md",
        content: "Hello ACME Corp, welcome aboard.",
      });

      const cr = await client.assets.editContent({
        assetId,
        edits: [{ oldString: "ACME Corp", newString: "Umbrella Inc" }],
      });
      expect(cr.status).toBe("in_review");
      expect(cr.primaryOperation?.operation).toBe("drive_file_update");

      // Not yet merged — the mounted file is untouched.
      const beforeMerge = await client.drives.readFile({
        nodeId: drive.node.id,
        filePath: "notes.md",
      });
      expect(beforeMerge.content).toBe("Hello ACME Corp, welcome aboard.");

      await approveAndMerge(cr.id);

      const afterMerge = await client.drives.readFile({
        nodeId: drive.node.id,
        filePath: "notes.md",
      });
      expect(afterMerge.content).toBe("Hello Umbrella Inc, welcome aboard.");
    });

    it("dispatches to the Skill mount (not just Drive) — proves ownerType dispatch works both ways", async () => {
      const skill = await client.skills.create({
        autoMerge: true,
        slug: "edit-content-happy-skill",
        name: "Edit Content Happy Skill",
        files: [{ path: "workflow.md", content: "Step one: contact SUPPORT_TEAM for help." }],
      });
      if (!("node" in skill)) throw new Error("expected an immediate node (autoMerge: true)");
      const assetId = expectDefined(skill.files.find((f) => f.path === "workflow.md")).assetId;

      const cr = await client.assets.editContent({
        assetId,
        edits: [{ oldString: "SUPPORT_TEAM", newString: "ONCALL_TEAM" }],
      });
      expect(cr.status).toBe("in_review");
      expect(cr.primaryOperation?.operation).toBe("skill_file_update");

      await approveAndMerge(cr.id);

      const afterMerge = await client.skills.readFile({
        nodeId: skill.node.id,
        filePath: "workflow.md",
      });
      expect(afterMerge.content).toBe("Step one: contact ONCALL_TEAM for help.");
    });

    it("replaceAll: true replaces every occurrence", async () => {
      const { drive, assetId } = await createMountedDriveFile({
        slug: "edit-content-replace-all-drive",
        path: "log.txt",
        content: "retry retry retry succeeded",
      });

      const cr = await client.assets.editContent({
        assetId,
        edits: [{ oldString: "retry", newString: "attempt", replaceAll: true }],
      });
      await approveAndMerge(cr.id);

      const afterMerge = await client.drives.readFile({
        nodeId: drive.node.id,
        filePath: "log.txt",
      });
      expect(afterMerge.content).toBe("attempt attempt attempt succeeded");
    });

    it("applies multiple edits sequentially — edit 2 sees edit 1's result", async () => {
      const { drive, assetId } = await createMountedDriveFile({
        slug: "edit-content-sequential-drive",
        path: "sequence.md",
        content: "one two three",
      });

      const cr = await client.assets.editContent({
        assetId,
        edits: [
          { oldString: "one two three", newString: "1 two three" },
          { oldString: "1 two", newString: "1 2" },
        ],
      });
      await approveAndMerge(cr.id);

      const afterMerge = await client.drives.readFile({
        nodeId: drive.node.id,
        filePath: "sequence.md",
      });
      expect(afterMerge.content).toBe("1 2 three");
    });
  });

  describe("rejections", () => {
    it("rejects an edit whose oldString is not found", async () => {
      const { assetId } = await createMountedDriveFile({
        slug: "edit-content-not-found-drive",
        path: "notes.md",
        content: "the quick brown fox",
      });

      await expect(
        client.assets.editContent({
          assetId,
          edits: [{ oldString: "slow purple fox", newString: "fast fox" }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects an ambiguous edit (multiple matches, no replaceAll)", async () => {
      const { assetId } = await createMountedDriveFile({
        slug: "edit-content-ambiguous-drive",
        path: "notes.md",
        content: "cat sat on the cat mat",
      });

      await expect(
        client.assets.editContent({
          assetId,
          edits: [{ oldString: "cat", newString: "dog" }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects a no-op edit where oldString === newString", async () => {
      const { assetId } = await createMountedDriveFile({
        slug: "edit-content-noop-drive",
        path: "notes.md",
        content: "unchanged content here",
      });

      await expect(
        client.assets.editContent({
          assetId,
          edits: [{ oldString: "unchanged", newString: "unchanged" }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects edits whose net effect is no change to the final content", async () => {
      const { assetId } = await createMountedDriveFile({
        slug: "edit-content-net-noop-drive",
        path: "notes.md",
        content: "alpha beta",
      });

      await expect(
        client.assets.editContent({
          assetId,
          edits: [
            { oldString: "alpha beta", newString: "beta alpha" },
            { oldString: "beta alpha", newString: "alpha beta" },
          ],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects an asset with zero editable mounts (uploaded but never mounted anywhere)", async () => {
      const contentHash = HASH("1");
      const requested = await client.assets.createUploadUrl({
        fileName: "unmounted.txt",
        mimeType: "text/plain",
        sizeBytes: 20,
        contentHash,
      });
      const confirmed = await client.assets.confirm({
        storageKey: requested.storageKey,
        fileName: "unmounted.txt",
        mimeType: "text/plain",
        sizeBytes: 20,
        contentHash,
      });
      const assetId = expectDefined(confirmed.assetId);

      await expect(
        client.assets.editContent({
          assetId,
          edits: [{ oldString: "anything", newString: "something" }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects content over the INLINE_TEXT_MAX_BYTES cap with PAYLOAD_TOO_LARGE", async () => {
      const bigContent = `${"a".repeat(1024 * 1024 + 10)}NEEDLE`;
      const { assetId } = await createMountedDriveFile({
        slug: "edit-content-too-big-drive",
        path: "huge.txt",
        content: bigContent,
      });

      await expect(
        client.assets.editContent({
          assetId,
          edits: [{ oldString: "NEEDLE", newString: "FOUND" }],
        }),
      ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    });
  });

  describe("baseContentHash conflict protection is inherited for free", () => {
    it("fails to merge with CONFLICT when the file changed underneath the editContent-created CR", async () => {
      // Regression-shaped proof: editContent must NOT reimplement conflict
      // detection — it threads `baseContentHash` (read before applying edits)
      // straight through to createDriveChangeRequest, so the EXISTING
      // mergeFileTreeFile optimistic-concurrency check in
      // domains/filetree/handlers.ts is what rejects this merge.
      const { drive, assetId } = await createMountedDriveFile({
        slug: "edit-content-conflict-drive",
        path: "shared.md",
        content: "version one of the document",
      });

      // editContent captures the CURRENT baseContentHash internally when this call runs.
      const editContentCr = await client.assets.editContent({
        assetId,
        edits: [{ oldString: "version one", newString: "version two" }],
      });
      expect(editContentCr.status).toBe("in_review");

      // Someone else changes the same file first, through the pre-existing
      // direct createChangeRequest path, and that CR merges cleanly.
      const interveningCr = await client.drives.createChangeRequest({
        nodeId: drive.node.id,
        operations: [
          { kind: "update", path: "shared.md", content: "an entirely different revision" },
        ],
        message: "Intervening edit",
        submittedBy: "someone-else",
      });
      await approveAndMerge(interveningCr.id);

      // Now the editContent-created CR is stale — merging it must CONFLICT,
      // exactly like drives-orpc.test.ts's "returns CONFLICT for stale Drive
      // file merges" case, proving no new/duplicate conflict logic was added.
      await client.changeRequests.review({
        changeRequestId: editContentCr.id,
        verdict: "approved",
      });
      await expect(
        client.changeRequests.merge({ changeRequestId: editContentCr.id }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });
});
