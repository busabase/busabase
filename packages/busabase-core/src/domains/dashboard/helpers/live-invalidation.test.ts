import type { liveEventSchema } from "busabase-contract/contract/busabase";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  classifyLiveInvalidation,
  createLiveInvalidationBatcher,
  LIVE_INVALIDATION_WINDOW_MS,
  type LiveInvalidationBatch,
} from "./live-invalidation";

type BusabaseLiveEvent = z.infer<typeof liveEventSchema>;

const event = (
  kind: BusabaseLiveEvent["kind"],
  overrides: Partial<BusabaseLiveEvent> = {},
): BusabaseLiveEvent => ({
  kind,
  spaceId: "space-1",
  actorId: "user-1",
  changeRequestId: kind === "node.metadata_updated" ? null : "cr-1",
  baseId: null,
  nodeIds: [],
  recordIds: [],
  viewIds: [],
  operationCount: 0,
  ...overrides,
});

afterEach(() => vi.useRealTimers());

describe("live invalidation classification", () => {
  it("uses pending_review only as a notification signal", () => {
    const batch = classifyLiveInvalidation(event("change_request.pending_review"));
    expect([...batch.targets]).toEqual([]);
    expect([...batch.baseIds]).toEqual([]);
  });

  it("keeps node metadata updates away from ChangeRequest queries", () => {
    const batch = classifyLiveInvalidation(
      event("node.metadata_updated", { nodeIds: ["node-1"], baseId: "base-1" }),
    );
    expect([...batch.targets].sort()).toEqual([
      "archivedNodes",
      "auditEvents",
      "nodeDetail",
      "nodeRouteState",
      "nodes",
    ]);
  });

  it("refreshes materialized resources only for merge events", () => {
    const created = classifyLiveInvalidation(
      event("change_request.created", { baseId: "base-1", recordIds: ["record-1"] }),
    );
    expect(created.targets).not.toContain("records");

    const merged = classifyLiveInvalidation(
      event("change_request.merged", {
        baseId: "base-1",
        nodeIds: ["node-1"],
        recordIds: ["record-1"],
      }),
    );
    expect(merged.targets).toContain("records");
    expect(merged.targets).toContain("nodes");
    expect(merged.targets).toContain("nodeRouteState");
    expect(merged.baseIds).toContain("base-1");
  });
});

describe("live invalidation batching", () => {
  it("refreshes the review queue when pending_review is the only received event", () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const batcher = createLiveInvalidationBatcher(flush, 50);
    batcher.push(event("change_request.pending_review"));
    vi.advanceTimersByTime(50);

    expect(flush).toHaveBeenCalledTimes(1);
    const batch = flush.mock.calls[0]?.[0] as LiveInvalidationBatch;
    expect([...batch.targets].sort()).toEqual([
      "changeRequestCounts",
      "changeRequests",
      "changeRequestsPaged",
      "inboxSnapshot",
    ]);
  });

  it("bounds a 100-event CR burst to one invalidation batch", () => {
    vi.useFakeTimers();
    const flushed: LiveInvalidationBatch[] = [];
    const batcher = createLiveInvalidationBatcher((batch) => flushed.push(batch));

    for (let index = 0; index < 100; index++) {
      batcher.push(event("change_request.created", { changeRequestId: `cr-${index}` }));
      batcher.push(event("change_request.pending_review", { changeRequestId: `cr-${index}` }));
    }

    vi.advanceTimersByTime(LIVE_INVALIDATION_WINDOW_MS - 1);
    expect(flushed).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(flushed).toHaveLength(1);
    expect([...(flushed[0]?.targets ?? [])].sort()).toEqual([
      "auditEvents",
      "changeRequestCounts",
      "changeRequests",
      "changeRequestsPaged",
      "inboxSnapshot",
    ]);
  });

  it("starts a new bounded window after the previous batch flushes", () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const batcher = createLiveInvalidationBatcher(flush, 50);
    batcher.push(event("change_request.updated"));
    vi.advanceTimersByTime(50);
    batcher.push(event("change_request.reviewed"));
    vi.advanceTimersByTime(50);
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
