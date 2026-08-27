import type { liveEventSchema } from "busabase-contract/contract/busabase";
import type { z } from "zod";

type BusabaseLiveEvent = z.infer<typeof liveEventSchema>;

// Production Snapshot requests take about 6.66 seconds. A 10-second fixed
// (not sliding) window collapses the usual updated -> pending_review ->
// reviewed -> merged sequence and lets the active query settle, without
// allowing a continuous event stream to postpone refreshes forever.
export const LIVE_INVALIDATION_WINDOW_MS = 10_000;
export const NODE_METADATA_INVALIDATION_WINDOW_MS = 300;

export type LiveInvalidationTarget =
  | "archivedBases"
  | "archivedNodes"
  | "auditEvents"
  | "bases"
  | "changeRequestCounts"
  | "changeRequests"
  | "changeRequestsPaged"
  | "inboxSnapshot"
  | "nodeDetail"
  | "nodes"
  | "records"
  | "recordsCount"
  | "recordsPage";

export interface LiveInvalidationBatch {
  baseIds: ReadonlySet<string>;
  targets: ReadonlySet<LiveInvalidationTarget>;
}

export const classifyLiveInvalidation = (event: BusabaseLiveEvent): LiveInvalidationBatch => {
  const targets = new Set<LiveInvalidationTarget>();
  const baseIds = new Set<string>();

  // This is an ephemeral notification paired with the persisted `created`
  // event. Refreshing here would issue the same list queries twice.
  if (event.kind === "change_request.pending_review") {
    return { baseIds, targets };
  }

  if (event.kind === "node.metadata_updated") {
    // The metadata write persists an audit event before publishing this live
    // signal, so Activity must advance together with the node views.
    targets.add("auditEvents");
    targets.add("nodes");
    targets.add("nodeDetail");
    targets.add("archivedNodes");
    return { baseIds, targets };
  }

  targets.add("changeRequests");
  targets.add("changeRequestsPaged");
  targets.add("inboxSnapshot");
  targets.add("changeRequestCounts");
  targets.add("auditEvents");

  // Only a merge materializes records, views, bases, or nodes. Earlier CR
  // lifecycle events change the review queue but not workspace content.
  if (event.kind === "change_request.merged") {
    const materializedOperationCount = event.recordIds.length + event.viewIds.length;
    const isPureRecordOrViewMerge =
      event.nodeIds.length === 0 &&
      materializedOperationCount > 0 &&
      event.operationCount === materializedOperationCount;

    if (event.nodeIds.length > 0) {
      targets.add("nodes");
      targets.add("nodeDetail");
      targets.add("archivedNodes");
      targets.add("bases");
      targets.add("archivedBases");
    }
    if (event.recordIds.length > 0) {
      targets.add("records");
      targets.add("recordsPage");
      targets.add("recordsCount");
    }
    if (event.viewIds.length > 0) {
      targets.add("records");
      targets.add("recordsPage");
      targets.add("recordsCount");
      if (event.baseId) baseIds.add(event.baseId);
    }
    // Unknown or mixed operations may include a schema/base change. Keep broad
    // invalidation unless every operation is explained by record/view ids.
    if (event.baseId && !isPureRecordOrViewMerge) {
      targets.add("records");
      targets.add("recordsPage");
      targets.add("recordsCount");
      targets.add("bases");
      targets.add("archivedBases");
      baseIds.add(event.baseId);
    }
  }

  return { baseIds, targets };
};

export interface LiveInvalidationBatcher {
  cancel(): void;
  push(event: BusabaseLiveEvent): void;
}

export const createLiveInvalidationBatcher = (
  flush: (batch: LiveInvalidationBatch) => void,
  windowMs: number = LIVE_INVALIDATION_WINDOW_MS,
): LiveInvalidationBatcher => {
  const pendingTargets = new Set<LiveInvalidationTarget>();
  const pendingBaseIds = new Set<string>();
  const pendingChangeRequests = new Map<
    string,
    { hasPendingReview: boolean; hasPersistedEvent: boolean }
  >();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flushPending = () => {
    timer = null;
    // `created` normally arrives beside `pending_review` and contributes these
    // targets already. If that persisted event was missed, refresh the queue
    // once at the end of the window so the notification cannot leave stale UI.
    const needsPendingReviewFallback = [...pendingChangeRequests.values()].some(
      ({ hasPendingReview, hasPersistedEvent }) => hasPendingReview && !hasPersistedEvent,
    );
    if (needsPendingReviewFallback && !pendingTargets.has("changeRequests")) {
      pendingTargets.add("changeRequests");
      pendingTargets.add("changeRequestsPaged");
      pendingTargets.add("inboxSnapshot");
      pendingTargets.add("changeRequestCounts");
    }
    pendingChangeRequests.clear();
    if (pendingTargets.size === 0 && pendingBaseIds.size === 0) return;
    const batch = {
      targets: new Set(pendingTargets),
      baseIds: new Set(pendingBaseIds),
    };
    pendingTargets.clear();
    pendingBaseIds.clear();
    flush(batch);
  };

  return {
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pendingTargets.clear();
      pendingBaseIds.clear();
      pendingChangeRequests.clear();
    },
    push(event) {
      const batch = classifyLiveInvalidation(event);
      if (event.kind !== "node.metadata_updated") {
        const changeRequestId = event.changeRequestId ?? "__unknown_change_request__";
        const state = pendingChangeRequests.get(changeRequestId) ?? {
          hasPendingReview: false,
          hasPersistedEvent: false,
        };
        if (event.kind === "change_request.pending_review") {
          state.hasPendingReview = true;
        } else {
          state.hasPersistedEvent = true;
        }
        pendingChangeRequests.set(changeRequestId, state);
      }
      for (const target of batch.targets) pendingTargets.add(target);
      for (const baseId of batch.baseIds) pendingBaseIds.add(baseId);
      if ((batch.targets.size > 0 || pendingChangeRequests.size > 0) && !timer) {
        timer = setTimeout(flushPending, windowMs);
      }
    },
  };
};
