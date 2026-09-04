import type { liveEventSchema } from "busabase-contract/contract/busabase";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  classifyLiveInvalidation,
  createLiveInvalidationBatcher,
  LIVE_INVALIDATION_WINDOW_MS,
  NODE_METADATA_INVALIDATION_WINDOW_MS,
} from "./live-invalidation";

type BusabaseLiveEvent = z.infer<typeof liveEventSchema>;

const mergedEvent = (overrides: Partial<BusabaseLiveEvent>): BusabaseLiveEvent => ({
  kind: "change_request.merged",
  spaceId: "space-1",
  actorId: "user-1",
  changeRequestId: "cr-1",
  baseId: "base-1",
  nodeIds: [],
  recordIds: [],
  viewIds: [],
  operationCount: 1,
  ...overrides,
});

afterEach(() => vi.useRealTimers());

describe("merge invalidation scope", () => {
  it("keeps a pure record merge away from Base schema queries", () => {
    const batch = classifyLiveInvalidation(mergedEvent({ recordIds: ["record-1"] }));

    expect(batch.targets).toContain("records");
    expect(batch.targets).not.toContain("bases");
    expect(batch.targets).not.toContain("archivedBases");
    expect(batch.baseIds).not.toContain("base-1");
  });

  it("refreshes view scope without reloading every Base schema", () => {
    const batch = classifyLiveInvalidation(mergedEvent({ viewIds: ["view-1"] }));

    expect(batch.targets).toContain("recordsPage");
    expect(batch.targets).not.toContain("bases");
    expect(batch.baseIds).toContain("base-1");
  });

  it("keeps broad Base invalidation for mixed schema and record operations", () => {
    const batch = classifyLiveInvalidation(
      mergedEvent({ operationCount: 2, recordIds: ["record-1"] }),
    );

    expect(batch.targets).toContain("records");
    expect(batch.targets).toContain("bases");
    expect(batch.targets).toContain("archivedBases");
    expect(batch.baseIds).toContain("base-1");
  });

  it("keeps node and Base targets for node merges", () => {
    const batch = classifyLiveInvalidation(mergedEvent({ nodeIds: ["node-1"] }));

    expect(batch.targets).toContain("nodes");
    expect(batch.targets).toContain("nodeRouteState");
    expect(batch.targets).toContain("bases");
    expect(batch.baseIds).toContain("base-1");
  });
});

describe("ChangeRequest lifecycle coalescing", () => {
  it("uses a fixed 10-second production window", () => {
    expect(LIVE_INVALIDATION_WINDOW_MS).toBe(10_000);
  });

  it("keeps node metadata updates on the original fast window", () => {
    expect(NODE_METADATA_INVALIDATION_WINDOW_MS).toBe(300);
  });

  it("coalesces consecutive lifecycle events for one ChangeRequest", () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const batcher = createLiveInvalidationBatcher(flush, 50);
    const baseEvent = mergedEvent({ recordIds: ["record-1"] });

    batcher.push({ ...baseEvent, kind: "change_request.updated" });
    batcher.push({ ...baseEvent, kind: "change_request.pending_review" });
    batcher.push({ ...baseEvent, kind: "change_request.reviewed" });
    batcher.push(baseEvent);
    vi.advanceTimersByTime(50);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0]?.[0].targets).toContain("inboxSnapshot");
    expect(flush.mock.calls[0]?.[0].targets).toContain("records");
  });
});
