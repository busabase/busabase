import type { BusabaseTaskClient, TaskDefinition } from "./types";

/**
 * The review queue, as three tasks instead of seven endpoints.
 *
 * Two collapses happen here:
 *
 * 1. `list` / `listPaged` / `counts` are one question ("what is in the queue?")
 *    asked three ways. An agent choosing between them has to know that
 *    `listPaged` is the one that scales and `list` is the one that quietly
 *    stops at a default limit — a distinction about pagination mechanics, not
 *    about intent.
 *
 * 2. `review` and `merge` each take an array of ids, so one canonical operation
 *    covers both single-item and multi-item actions.
 *
 * `close` and `get` keep their own endpoint tools: `close` is genuinely a
 * different decision from approve/reject, and `get` is a plain fetch.
 */

const REVIEW_GUIDANCE =
  "This records a HUMAN decision. Never call it unless the user explicitly asked for this specific verdict on these specific change requests. " +
  "Summarising a change request for the user is not permission to approve it.";

const singleItemError = (result: { error?: string; code?: string; data?: unknown } | undefined) =>
  Object.assign(new Error(result?.error ?? "Change request action returned no result"), {
    ...(result?.code ? { code: result.code } : {}),
    ...(result?.data === undefined ? {} : { data: result.data }),
  });

export interface ChangeRequestQueryInput {
  status?: string;
  mine?: boolean;
  affectsNodeId?: string;
  limit?: number;
  cursor?: string;
  countsOnly?: boolean;
}

export const changeRequestQueryTask: TaskDefinition<ChangeRequestQueryInput> = {
  name: "change_request_query",
  cliPath: ["change-requests", "query"],
  cliVariants: [
    {
      path: ["change-requests", "counts"],
      preset: { countsOnly: true },
      summary: "Count change requests per inbox tab",
    },
  ],
  summary: "List change requests, or count them per inbox tab",
  guidance:
    "Keyset-paginated: page with the returned `cursor` rather than raising `limit`. " +
    "Pass countsOnly for just the per-tab totals (review / changes / created / approved / merged / rejected) without fetching rows. " +
    "To check whether a specific resource already has an unfinished change request, pass affectsNodeId with limit 1 instead of paging the whole space: an empty result is conclusive.",
  annotations: { readOnly: true, destructive: false },
  params: [
    {
      name: "status",
      kind: "string",
      description: "Filter by status, e.g. `in_review`, `approved`, `merged`.",
    },
    { name: "mine", kind: "boolean", description: "Only change requests you submitted." },
    {
      name: "affectsNodeId",
      kind: "string",
      description:
        "Only change requests affecting this node — matching the node directly, its Base, or any of the change request's operations. Not available on the counts variant, whose totals are always space-wide.",
    },
    { name: "limit", kind: "number", min: 1, max: 100, description: "Page size; 100 max." },
    { name: "cursor", kind: "string", description: "Opaque cursor from the previous page." },
    {
      name: "countsOnly",
      kind: "boolean",
      description: "Return per-tab counts instead of rows.",
    },
  ],
  examples: [
    "busabase-cli change-requests query --status in_review",
    "busabase-cli change-requests query --affects-node-id nod_123 --status in_review --limit 1",
    "busabase-cli change-requests counts",
  ],
  execute: async (client: BusabaseTaskClient, input: ChangeRequestQueryInput) => {
    if (input.countsOnly) return client.changeRequests.counts();
    return client.changeRequests.list({
      ...(input.status ? { status: input.status } : {}),
      ...(input.mine !== undefined ? { mine: input.mine } : {}),
      ...(input.affectsNodeId ? { affectsNodeId: input.affectsNodeId } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    } as Parameters<BusabaseTaskClient["changeRequests"]["list"]>[0]);
  },
};

export interface ChangeRequestReviewInput {
  changeRequestIds: string[];
  verdict: string;
  reason?: string;
}

export const changeRequestReviewTask: TaskDefinition<ChangeRequestReviewInput> = {
  name: "change_request_review",
  cliPath: ["change-requests", "review"],
  summary: "Review a Change Request (rejected = request changes, not terminal)",
  guidance:
    `${REVIEW_GUIDANCE} Reviewing does not merge — approve first, then merge separately. ` +
    "A `rejected` verdict asks the submitter for changes and leaves the change request open; " +
    "to end it for good use `change_requests_close`.",
  annotations: { readOnly: false, destructive: false },
  params: [
    {
      name: "changeRequestIds",
      kind: "stringArray",
      required: true,
      description: "Change request ids. One id is fine; up to 100 per call.",
      cliFlag: "--change-request-id",
    },
    {
      name: "verdict",
      kind: "enum",
      required: true,
      choices: ["approved", "rejected"],
      description: "The human's decision.",
    },
    {
      name: "reason",
      kind: "string",
      description: "Explanation shown to the submitter. Required in practice for a rejection.",
    },
  ],
  examples: [
    "busabase-cli change-requests review --change-request-id crq_1 --verdict approved",
    'busabase-cli change-requests review --change-request-id crq_1 --change-request-id crq_2 --verdict rejected --reason "Wrong Base"',
  ],
  execute: async (client: BusabaseTaskClient, input: ChangeRequestReviewInput) => {
    const ids = input.changeRequestIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error("changeRequestIds must contain at least one id.");
    }
    const verdict = input.verdict as "approved" | "rejected";
    const response = await client.changeRequests.review({
      changeRequestIds: ids,
      verdict,
      ...(input.reason ? { reason: input.reason } : {}),
    });
    if (ids.length !== 1) return response;
    const result = response.results[0];
    if (!result?.ok) throw singleItemError(result);
    return result.changeRequest;
  },
};

export interface ChangeRequestMergeInput {
  changeRequestIds: string[];
}

export const changeRequestMergeTask: TaskDefinition<ChangeRequestMergeInput> = {
  name: "change_request_merge",
  cliPath: ["change-requests", "merge"],
  summary: "Merge one or more approved change requests",
  guidance: `${REVIEW_GUIDANCE} Merging is irreversible — it writes the proposed changes into the canonical data.`,
  annotations: { readOnly: false, destructive: true },
  params: [
    {
      name: "changeRequestIds",
      kind: "stringArray",
      required: true,
      description: "Change request ids to merge. One id is fine; up to 100 per call.",
      cliFlag: "--change-request-id",
    },
  ],
  examples: [
    "busabase-cli change-requests merge --change-request-id crq_1",
    "busabase-cli change-requests merge --change-request-id crq_1 --change-request-id crq_2",
  ],
  execute: async (client: BusabaseTaskClient, input: ChangeRequestMergeInput) => {
    const ids = input.changeRequestIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error("changeRequestIds must contain at least one id.");
    }
    const response = await client.changeRequests.merge({ changeRequestIds: ids });
    if (ids.length !== 1) return response;
    const result = response.results[0];
    if (!result?.ok) throw singleItemError(result);
    return {
      changeRequest: result.changeRequest,
      record: result.record,
      view: result.view,
    };
  },
};
