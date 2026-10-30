import "server-only";

import { and, eq } from "drizzle-orm";
import type { getDb } from "../../../db";
import { busabaseOperations, busabaseReviews } from "../../../db/schema";

type RelatedRequest = {
  id: string;
  sourceMeta: Record<string, unknown>;
  reviewPolicySnapshot: Record<string, unknown>;
};

export const relatedFieldRequiredApprovals = (request: RelatedRequest): number => {
  if (request.sourceMeta.relatedFieldCreation !== true) return 1;
  const value = request.reviewPolicySnapshot.requiredApprovals;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
};

/** Only approvals of every current operation head count for a paired schema change. */
export const relatedFieldApprovalsSatisfied = async (
  db: Awaited<ReturnType<typeof getDb>>,
  request: RelatedRequest,
): Promise<boolean> => {
  if (request.sourceMeta.relatedFieldCreation !== true) return true;
  const required = relatedFieldRequiredApprovals(request);
  const operations = await db
    .select({ id: busabaseOperations.id, head: busabaseOperations.headCommitId })
    .from(busabaseOperations)
    .where(eq(busabaseOperations.changeRequestId, request.id));
  const reviews = await db
    .select()
    .from(busabaseReviews)
    .where(
      and(eq(busabaseReviews.changeRequestId, request.id), eq(busabaseReviews.verdict, "approved")),
    );
  const valid = reviews.filter(
    (review) =>
      (required === 1 && review.reviewerId === "system:auto-merge") ||
      operations.every(
        (operation) => review.visibleOperationHeads?.[operation.id] === operation.head,
      ),
  );
  return (
    operations.length > 0 && new Set(valid.map((review) => review.reviewerId)).size >= required
  );
};
