import type { QueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { ChangeRequestOutcome } from "~/domains/base/utils/change-request-result";
import { isMergedOutcome } from "~/domains/base/utils/change-request-result";
import { invalidateMobileWorkspaceQueries } from "./mobile-query-recovery";

interface WorkspaceWriteClient {
  orpc: BusabaseQueryUtils;
  scopeKey: string;
}

export function invalidateWorkspaceWrite(
  queryClient: QueryClient,
  workspace: WorkspaceWriteClient,
  outcome: ChangeRequestOutcome | "reviewed" | "merged",
) {
  const canonicalChanged =
    outcome === "merged" || (typeof outcome === "object" && isMergedOutcome(outcome));
  invalidateMobileWorkspaceQueries(
    queryClient,
    workspace.scopeKey,
    canonicalChanged
      ? undefined
      : [
          workspace.orpc.changeRequests.key(),
          workspace.orpc.records.listChangeRequests.key(),
          workspace.orpc.auditEvents.key(),
          [workspace.scopeKey, "inbox"],
          [workspace.scopeKey, "pending-change-requests"],
          [workspace.scopeKey, "activity"],
        ],
  );
}
