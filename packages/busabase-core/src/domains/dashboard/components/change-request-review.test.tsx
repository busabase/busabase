import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { ChangeRequestVO } from "busabase-contract/types";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { ChangeRequestReviewLayout } from "./change-request-review";

Object.assign(globalThis, { React });

vi.mock("./operation-diff", () => ({
  OperationFieldChanges: () => React.createElement("div", null, "Before & Co → After Ltd"),
}));

const timestamp = "2026-08-25T08:00:00.000Z";
const operation = {
  id: "opr_preview",
  changeRequestId: "crq_preview",
  baseId: "bas_customers",
  targetType: "base",
  nodeId: "nod_customers",
  operation: "record_update",
  status: "pending",
  targetRecordId: "rec_customer",
  targetViewId: null,
  filePath: null,
  sourceRecordId: null,
  sourceCommitId: null,
  baseCommitId: "cmt_before",
  headCommitId: "cmt_after",
  deleteMode: "archive",
  mergedRecordId: null,
  mergedViewId: null,
  position: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
  baseFields: { company: "Before & Co" },
  headCommit: {
    id: "cmt_after",
    baseId: "bas_customers",
    targetType: "base",
    nodeId: "nod_customers",
    operationId: "opr_preview",
    parentCommitId: "cmt_before",
    payload: { company: "After Ltd" },
    operation: "record_update",
    message: "Update customer",
    author: "agent_1",
    createdAt: timestamp,
  },
} satisfies ChangeRequestVO["operations"][number];

const changeRequest = {
  id: "crq_preview",
  baseId: "bas_customers",
  targetType: "base",
  nodeId: "nod_customers",
  status: "in_review",
  submittedBy: "agent_1",
  sourceMeta: {},
  reviewPolicySnapshot: {},
  mergeSummary: {},
  rejectedReason: null,
  reviewedAt: null,
  mergedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  base: {
    id: "bas_customers",
    nodeId: "nod_customers",
    slug: "customers",
    name: "Customers",
    description: "",
    reviewPolicy: { kind: "single", requiredApprovals: 1 },
    createdAt: timestamp,
    fields: [],
  },
  node: null,
  operations: [operation],
  primaryOperation: operation,
  operationCount: 1,
  reviews: [],
} satisfies ChangeRequestVO;

const client = {
  listComments: vi.fn(async () => []),
} as unknown as BusabaseDashboardApiClient;

const useStaticLocation = (): [string, (path: string) => void] => [
  "/inbox/crq_preview",
  () => undefined,
];
const useStaticSearch = () => "";

const renderReview = (readOnly: boolean) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Router hook={useStaticLocation} searchHook={useStaticSearch}>
        <CoreI18nProvider locale="en">
          <ChangeRequestReviewLayout
            auditEvents={[]}
            changeRequest={changeRequest}
            client={client}
            focusOperationId={null}
            onApprove={() => undefined}
            onClose={() => undefined}
            onMerge={() => undefined}
            onReject={() => undefined}
            pendingAction={null}
            readOnly={readOnly}
          />
        </CoreI18nProvider>
      </Router>
    </QueryClientProvider>,
  );

describe("Change Request read-only preview", () => {
  it("reuses the review surface while removing every mutation control", () => {
    const markup = renderReview(true);

    expect(markup).toContain('data-change-request-read-only="true"');
    expect(markup).toContain("Customers");
    expect(markup).toContain("Before &amp; Co");
    expect(markup).toContain("After Ltd");
    expect(markup).not.toContain("Finish review");
    expect(markup).not.toContain('aria-label="Add comment"');
    expect(markup).not.toContain("Quote reply");
  });

  it("keeps the existing dashboard review controls by default", () => {
    const markup = renderReview(false);

    expect(markup).toContain("Finish review");
    expect(markup).toContain('aria-label="Add comment"');
  });
});
