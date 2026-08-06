import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Regression coverage for a crash reported end-to-end: revising a pending file
 * operation on a Skill/Drive/AirApp Change Request (e.g. to correct a
 * `baseContentHash` that didn't match the `sha256:<hex>` format and blocked
 * the merge) threw an uncaught `Error` — surfaced to callers as HTTP 500 —
 * instead of succeeding or failing with a clean error.
 *
 * Root cause: `reviseOperation` (packages/busabase-core/src/logic/cr-lifecycle.ts)
 * is generic across every operation kind and unconditionally re-projected field
 * values via `projectCommitFields`, which requires a Base id. File-tree
 * operations are node-scoped (`operation.baseId === null`) — they never had
 * field values projected on creation either (see filetree/handlers.ts) — so
 * `requireBaseId(operation.baseId, ...)` always threw for this class of
 * operation. Fixed by only re-projecting fields when the operation actually
 * carries a `baseId`.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

// PGlite migrations are an app artifact resolved from `process.cwd()/src/db/
// migrations`; busabase-core has none of its own, so the test runs against the
// reference app's migrations (busabase). Same schema, owned by busabase-core.
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("operations.revise — file-tree (Skill/Drive/AirApp) operations", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-revise-filetree-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-revise-filetree-storage-"));
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

  it("revises a pending Skill file operation's baseContentHash instead of throwing", async () => {
    const skill = await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      slug: "revise-target",
      name: "Revise Target",
    });
    const current = await client.fileTrees.readFile({
      type: "skill",
      nodeId: skill.node.id,
      filePath: "SKILL.md",
    });

    // Propose the update with a syntactically-valid but WRONG baseContentHash —
    // mirrors the reported incident: a stale/incorrect baseline that will never
    // match the current content and blocks the merge until corrected.
    const wrongHash = `sha256:${"0".repeat(64)}`;
    const changeRequest = await client.fileTrees.createChangeRequest({
      autoMerge: false,
      type: "skill",
      nodeId: skill.node.id,
      message: "Add a checklist section",
      submittedBy: "vitest-agent",
      operations: [
        {
          kind: "update",
          path: "SKILL.md",
          content: `${current.content}\n## Checklist\n`,
          baseContentHash: wrongHash,
        },
      ],
    });
    expect(changeRequest.status).toBe("in_review");
    const operationId = changeRequest.primaryOperation?.id;
    if (!operationId) throw new Error("Expected a primaryOperation id on the pending CR");

    // Merging now would correctly reject as a hash mismatch — the interesting
    // part is fixing it via `operations.revise` instead of closing and
    // recreating the whole Change Request, which previously threw a 500.
    const revised = await client.operations.revise({
      operationId,
      // Mirrors the commit-fields shape `filetree/handlers.ts` builds for a text
      // file update: `nextContent`/`encoding`, not the operation-input's `content`.
      fields: {
        filePath: "SKILL.md",
        baseContentHash: current.contentHash,
        nextContent: `${current.content}\n## Checklist\n\n- Verify sources.\n`,
        encoding: "utf8",
        mimeType: "text/markdown",
      },
    });
    expect(revised.status).toBe("in_review");

    await client.changeRequests.review({
      changeRequestIds: [changeRequest.id],
      verdict: "approved",
    });
    const [result] = (await client.changeRequests.merge({ changeRequestIds: [changeRequest.id] }))
      .results;
    if (!result?.ok) {
      throw new Error(`Expected merge to succeed, got: ${JSON.stringify(result)}`);
    }

    const updated = await client.fileTrees.readFile({
      type: "skill",
      nodeId: skill.node.id,
      filePath: "SKILL.md",
    });
    expect(updated.content).toContain("- Verify sources.");
  });
});
