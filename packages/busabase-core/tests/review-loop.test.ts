import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * The review state machine, driven through the real oRPC router:
 *   in_review → (request changes) → changes_requested → (agent revises) → in_review
 *             → (approve) → approved → (merge) → merged
 * plus the explicit terminal close. "Request changes" must NOT be terminal, and a
 * revised CR must return to the reviewer's queue.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("Change-request review loop — oRPC", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let blogBaseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-loop-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-loop-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });
    const bases = await client.bases.list();
    blogBaseId = bases.find((base) => base.slug === "blog")?.id ?? "";
    expect(blogBaseId).not.toBe("");
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) {
      process.chdir(originalCwd);
    }
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  const openCr = () =>
    client.bases.createChangeRequest({
      baseId: blogBaseId,
      fields: { title: "Loop test", body: "v1", channel: "blog" },
      message: "Initial",
      submittedBy: "loop-agent",
    });

  it("request changes is non-terminal and revising returns the CR to in_review", async () => {
    const cr = await openCr();
    expect(cr.status).toBe("in_review");
    const operationId = cr.primaryOperation?.id ?? "";
    expect(operationId).not.toBe("");

    const reviewed = await client.changeRequests.review({
      changeRequestId: cr.id,
      verdict: "rejected",
      reason: "Tighten the intro. @ai",
    });
    // "request changes" → soft, revisable state — NOT rejected.
    expect(reviewed.status).toBe("changes_requested");
    expect(reviewed.reviews.at(-1)?.reason).toContain("Tighten");

    // The agent responds by revising → CR returns to the reviewer's queue.
    const revised = await client.operations.revise({
      operationId,
      fields: { title: "Loop test", body: "v2 — revised", channel: "blog" },
    });
    expect(revised.status).toBe("in_review");

    // Re-review → approve → merge.
    const approved = await client.changeRequests.review({
      changeRequestId: cr.id,
      verdict: "approved",
    });
    expect(approved.status).toBe("approved");
    const merged = await client.changeRequests.merge({ changeRequestId: cr.id });
    expect(merged.changeRequest.status).toBe("merged");
  });

  it("close is terminal and blocks further revision", async () => {
    const cr = await openCr();
    const operationId = cr.primaryOperation?.id ?? "";

    const closed = await client.changeRequests.close({
      changeRequestId: cr.id,
      reason: "Out of scope",
    });
    expect(closed.status).toBe("rejected");

    await expect(
      client.operations.revise({
        operationId,
        fields: { title: "nope", body: "x", channel: "blog" },
      }),
    ).rejects.toThrow(/not revisable/);
  });
});
