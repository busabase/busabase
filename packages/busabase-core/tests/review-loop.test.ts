import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID } from "../src/context";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { type BusabaseLiveEvent, subscribeBusabaseLiveEvents } from "../src/logic/live-events";
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

const nextLiveEvent = async (iterator: AsyncGenerator<BusabaseLiveEvent>) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out waiting for live event")), 1000);
      }),
    ]);
    if (result.done) {
      throw new Error("Live event stream ended before yielding an event");
    }
    return result.value;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

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
      autoMerge: false,
    });

  it("publishes live events when CRs are created and reviewed", async () => {
    const controller = new AbortController();
    const iterator = subscribeBusabaseLiveEvents(LOCAL_SPACE_ID, controller.signal);
    try {
      const createdEventPromise = nextLiveEvent(iterator);
      const cr = await openCr();
      const createdEvent = await createdEventPromise;
      expect(createdEvent.kind).toBe("change_request.created");
      expect(createdEvent.changeRequestId).toBe(cr.id);
      expect(createdEvent.baseId).toBe(blogBaseId);
      expect(createdEvent.actorId).toBe("loop-agent");

      // Creating a CR also broadcasts a "needs review" signal for desktop/inbox
      // notifications (see `publishChangeRequestPendingReview`) — drain it before
      // listening for the next lifecycle event, or the next `nextLiveEvent()` call
      // below would consume this one instead of the "reviewed" event it expects.
      const pendingReviewEvent = await nextLiveEvent(iterator);
      expect(pendingReviewEvent.kind).toBe("change_request.pending_review");
      expect(pendingReviewEvent.changeRequestId).toBe(cr.id);

      const reviewedEventPromise = nextLiveEvent(iterator);
      const reviewed = await client.changeRequests.review({
        changeRequestId: cr.id,
        verdict: "rejected",
        reason: "Needs another pass",
      });
      const reviewedEvent = await reviewedEventPromise;
      expect(reviewed.status).toBe("changes_requested");
      expect(reviewedEvent.kind).toBe("change_request.reviewed");
      expect(reviewedEvent.changeRequestId).toBe(cr.id);
      expect(reviewedEvent.baseId).toBe(blogBaseId);
      expect(reviewedEvent.actorId).toBe("local-admin");
    } finally {
      controller.abort();
      await iterator.return(undefined);
    }
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
