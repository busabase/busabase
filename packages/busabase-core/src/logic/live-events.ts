import type { liveEventSchema } from "busabase-contract/contract/busabase";
import { publishRealtimeMessage, subscribeRealtimeMessages } from "openlib/realtime";
import type { z } from "zod";
import { getContextChangeRequestPendingReviewHook } from "../context";

export type BusabaseLiveEvent = z.infer<typeof liveEventSchema>;

const channelForSpace = (spaceId: string) => `busabase:live:${spaceId}`;

export const publishBusabaseLiveEvent = async (event: BusabaseLiveEvent) => {
  await publishRealtimeMessage(channelForSpace(event.spaceId), event);
};

export interface ChangeRequestPendingReviewArgs {
  spaceId: string;
  baseId: string | null;
  changeRequestId: string;
  /** Whoever submitted the change request — excluded from its own notification. */
  submittedBy: string;
}

/**
 * Fire whenever a change request freshly lands in `in_review` status — i.e. it
 * now needs a human reviewer and won't get one automatically. Called from every
 * `create*ChangeRequest` entry point that can produce an `in_review` row:
 * `record-ops.ts` (record create/update/delete/restore), `field-ops.ts` (base
 * field create/update/delete/convert/reorder/restore), `view-ops.ts` (view
 * create/update/delete/restore), `doc/handlers.ts` and `filetree/handlers.ts`
 * (doc/drive file edits), and `nodes.ts`'s `createNodeChangeRequest` when its
 * caller didn't pass `autoMerge` (the UI's default "New base/skill/folder" flow).
 * Skipped wherever a change auto-merges instead of entering review (e.g.
 * `autoMerge: true` callers, or code paths that call `recordMergedOperation`
 * directly) — those never sit in anyone's inbox, so there is nothing to notify.
 *
 * Two independent effects:
 *  - Always: broadcast an ephemeral `change_request.pending_review` live event
 *    over the space's SSE channel. Every connected dashboard tab decides for
 *    itself whether to pop a desktop Notification (open source's path — no
 *    persistence; see `use-live-sync.ts`).
 *  - Only if the host registered `onChangeRequestPendingReview` on its
 *    `BusabaseContext` (busabase-cloud does, to persist a real inbox
 *    notification row): also invoke it. Best-effort — a notification failure
 *    must never fail the change-request creation that triggered it.
 */
export const publishChangeRequestPendingReview = async (
  args: ChangeRequestPendingReviewArgs,
): Promise<void> => {
  try {
    await publishBusabaseLiveEvent({
      kind: "change_request.pending_review",
      spaceId: args.spaceId,
      actorId: args.submittedBy,
      changeRequestId: args.changeRequestId,
      baseId: args.baseId,
      nodeIds: [],
      recordIds: [],
      viewIds: [],
      operationCount: 0,
    });
  } catch {
    // Best-effort — a live-event/notification failure must never fail the
    // change-request creation that already committed above (Redis network
    // errors in cloud mode; a throwing subscriber re-entering synchronously
    // in local mode).
  }

  const hook = getContextChangeRequestPendingReviewHook();
  if (!hook) {
    return;
  }
  try {
    await hook(args);
  } catch {
    // Best-effort — notification delivery must never fail CR creation.
  }
};

export async function* subscribeBusabaseLiveEvents(
  spaceId: string,
  signal?: AbortSignal,
): AsyncGenerator<BusabaseLiveEvent> {
  const queue: BusabaseLiveEvent[] = [];
  let wake: (() => void) | null = null;

  const unsubscribe = subscribeRealtimeMessages<BusabaseLiveEvent>(
    channelForSpace(spaceId),
    (event) => {
      queue.push(event);
      wake?.();
      wake = null;
    },
    signal,
  );

  try {
    while (!signal?.aborted) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }

      await new Promise<void>((resolve) => {
        wake = resolve;
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  } finally {
    unsubscribe();
  }
}
