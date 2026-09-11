import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * A field type change asked for the wrong way must fail, not quietly succeed.
 *
 * `bases.fieldChangeRequest` with `operation: "update"` takes a `patch` object
 * that is deliberately NOT `.strict()` (see `contract/auto-merge.ts`: the SDK
 * ships on its own cadence against self-hosted servers, so a newer client
 * sending a newer optional key is normal traffic). The cost of that openness
 * was that `patch: { type: "markdown" }` got stripped before any handler saw
 * it: the request validated, the change request merged, `ok: true` came back,
 * and the field kept its old type. A successful no-op that reads exactly like
 * a successful conversion.
 *
 * Exercised through the real oRPC router so the contract's input validation is
 * actually in the path — the core handler never parses the schema itself, so a
 * direct handler call would prove nothing about this.
 */
type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("field type change via update.patch — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let fieldId = "";

  const fieldById = async (id: string) => {
    const base = await client.bases.get({ baseId });
    return base?.fields.find((f) => f.id === id);
  };

  const approveMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({
      changeRequestIds: [changeRequestId],
      verdict: "approved",
    });
    await client.changeRequests.merge({ changeRequestIds: [changeRequestId] });
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-fieldtype-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-fieldtype-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "notes",
      name: "Notes",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true, options: {} },
        { slug: "body", name: "Body", type: "longtext", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;
    fieldId = base.fields.find((f) => f.slug === "body")?.id ?? "";
    expect(fieldId).not.toBe("");
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a type change on update instead of merging a no-op", async () => {
    const error = await client.bases
      .fieldChangeRequest({
        baseId,
        operation: "update",
        fieldId,
        // Deliberately the shape the contract now refuses — that is the test.
        patch: { type: "markdown" } as never,
        message: "wrong operation for a type change",
        submittedBy: "test",
        autoMerge: false,
      })
      .catch((e: unknown) => e as { status?: number; data?: { issues?: unknown[] } });

    expect(error?.status).toBe(400);

    // The field is untouched, and — the part that actually mattered — no
    // change request was left behind claiming otherwise.
    expect((await fieldById(fieldId))?.type).toBe("longtext");
  });

  it("names the operation that does work, on the offending key", async () => {
    const error = await client.bases
      .fieldChangeRequest({
        baseId,
        operation: "update",
        fieldId,
        patch: { type: "markdown" } as never,
        submittedBy: "test",
        autoMerge: false,
      })
      .catch(
        (e: unknown) => e as { data?: { issues?: Array<{ path?: unknown[]; message?: string }> } },
      );

    // The top-level message stays the generic "Input validation failed" — the
    // guidance lives on the issue, which is what the SDK folds into the
    // message a caller actually reads.
    const issue = error?.data?.issues?.find((i) => JSON.stringify(i.path) === '["patch","type"]');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("convert");
    expect(issue?.message).toContain("previewFieldConversion");
  });

  it("still accepts the keys update is for", async () => {
    const cr = await client.bases.fieldChangeRequest({
      baseId,
      operation: "update",
      fieldId,
      patch: { name: "Body Text" },
      submittedBy: "test",
      autoMerge: false,
    });
    await approveMerge(cr.id);

    const field = await fieldById(fieldId);
    expect(field?.name).toBe("Body Text");
    expect(field?.type).toBe("longtext");
  });

  it("convert is the path that actually changes the type", async () => {
    const cr = await client.bases.fieldChangeRequest({
      baseId,
      operation: "convert",
      fieldId,
      newType: "markdown",
      submittedBy: "test",
      autoMerge: false,
    });
    await approveMerge(cr.id);

    expect((await fieldById(fieldId))?.type).toBe("markdown");
  });
});
