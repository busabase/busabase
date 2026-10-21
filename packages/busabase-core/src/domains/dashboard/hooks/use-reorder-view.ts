import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { ViewVO } from "busabase-contract/types";
import { toast } from "sonner";
import { applyOptimisticViewReorder } from "../helpers/view-order";

export interface ReorderViewPayload {
  view: ViewVO;
  /** 0-based target index among the Base's active views (0 = the view the Base opens on). */
  position: number;
}

/**
 * Drag-to-reorder for a Base's view tabs. The order is shared, so it is a real
 * view update (`views.changeRequest` with `position`) merged in the same call —
 * the same "apply now" path the table's inline view controls use. The views
 * cache is reordered optimistically so the tab lands where it was dropped, and
 * rolled back if the server refuses.
 */
export function useReorderView({
  apiClient,
  queryClient,
  viewsQueryKey,
  messages,
  onSettled,
}: {
  apiClient: Pick<BusabaseDashboardApiClient, "createUpdateViewChangeRequest">;
  queryClient: QueryClient;
  /** EXACT key of the rendered `bases.listViews` query (set/getQueryData need an exact match). */
  viewsQueryKey: QueryKey;
  messages: {
    /** Commit message for the change request. */
    changeRequestMessage: (payload: ReorderViewPayload) => string;
    failed: string;
    /** Shown when the server queued the move for review instead of merging it. */
    proposed: string;
  };
  onSettled?: () => Promise<unknown> | undefined;
}) {
  return useMutation({
    mutationFn: (payload: ReorderViewPayload) =>
      apiClient.createUpdateViewChangeRequest(payload.view.id, {
        position: payload.position,
        message: messages.changeRequestMessage(payload),
        submittedBy: "local-editor",
        autoMerge: true,
      }),
    onMutate: async (payload: ReorderViewPayload) => {
      await queryClient.cancelQueries({ queryKey: viewsQueryKey });
      const previous = queryClient.getQueryData<ViewVO[]>(viewsQueryKey);
      if (previous) {
        queryClient.setQueryData<ViewVO[]>(
          viewsQueryKey,
          applyOptimisticViewReorder(previous, payload.view.id, payload.position),
        );
      }
      return { previous };
    },
    onSuccess: (result, _payload, context) => {
      if (result.materialized) return;
      // Without write access the server proposes instead of merging, so the
      // shared order has not changed yet — put the tabs back the way they are.
      if (context?.previous) {
        queryClient.setQueryData(viewsQueryKey, context.previous);
      }
      toast.info(messages.proposed);
    },
    onError: (_error, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(viewsQueryKey, context.previous);
      }
      toast.error(messages.failed);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: viewsQueryKey }),
        onSettled?.(),
      ]);
    },
  });
}
