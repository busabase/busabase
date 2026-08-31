import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { AuditEventVO, ChangeRequestVO } from "busabase-contract/types";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { type DashboardVisitorKind, DashboardVisitorProvider } from "../visitor-context";
import { ChangeRequestReviewLayout } from "./change-request-review";

Object.assign(globalThis, { React });

vi.mock("./operation-diff", () => ({
  OperationFieldChanges: () => React.createElement("div", null, "Before & Co → After Ltd"),
  // `operation-revise` imports these from the same module; leaving them out of the
  // mock makes them `undefined` and the revise form throws the moment it opens.
  getOperationFieldLabel: (_cr: unknown, _op: unknown, slug: string) => slug,
  isLongTextValue: (value: unknown) =>
    typeof value === "string" && (value.length > 56 || value.includes("\n")),
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
    metadata: {},
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

const renderReview = (
  readOnly: boolean,
  visitorKind: DashboardVisitorKind = "member",
  overrides: { auditEvents?: AuditEventVO[]; changeRequest?: ChangeRequestVO } = {},
) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Router hook={useStaticLocation} searchHook={useStaticSearch}>
        <CoreI18nProvider locale="en">
          <DashboardVisitorProvider visitorKind={visitorKind}>
            <ChangeRequestReviewLayout
              auditEvents={overrides.auditEvents ?? []}
              changeRequest={overrides.changeRequest ?? changeRequest}
              client={client}
              focusOperationId={null}
              onApprove={() => undefined}
              onClose={() => undefined}
              onMerge={() => undefined}
              onReject={() => undefined}
              pendingAction={null}
              readOnly={readOnly}
            />
          </DashboardVisitorProvider>
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

  it("hides comment threads for anonymous embed visitors", () => {
    const markup = renderReview(true, "anonymous");

    expect(markup).toContain("Before &amp; Co");
    expect(markup).toContain("Discussion");
    expect(markup).not.toContain("Comments on this change");
    expect(markup).not.toContain("No comments yet. Start the discussion below.");
  });
});

const revisionEvent = {
  id: "aud_revision",
  action: "change_request.updated",
  actorId: "usr_reviewer",
  actor: null,
  baseId: "bas_customers",
  recordId: null,
  changeRequestId: "crq_preview",
  operationId: "opr_preview",
  commitId: "cmt_after",
  metadata: { operation: "record_update", revision: true },
  createdAt: timestamp,
} as unknown as AuditEventVO;

describe("Operation revise entry point", () => {
  it("offers Edit on a revisable change request", () => {
    expect(renderReview(false)).toContain("Edit");
  });

  it("withholds Edit in the read-only preview", () => {
    expect(renderReview(true)).not.toContain(">Edit<");
  });

  it("withholds Edit from anonymous embed visitors", () => {
    expect(renderReview(false, "anonymous")).not.toContain(">Edit<");
  });

  it.each(["approved", "merged", "rejected", "closed"])(
    "withholds Edit once the change request is %s",
    (status) => {
      const markup = renderReview(false, "member", {
        changeRequest: { ...changeRequest, status } as ChangeRequestVO,
      });

      expect(markup).not.toContain(">Edit<");
    },
  );

  it("offers Edit on a conflicted change request — revising is the documented exit", () => {
    const markup = renderReview(false, "member", {
      changeRequest: { ...changeRequest, status: "conflict" } as ChangeRequestVO,
    });

    expect(markup).toContain("Edit");
  });
});

describe("Revision timeline", () => {
  it("records a revision in the discussion timeline", () => {
    const markup = renderReview(false, "member", { auditEvents: [revisionEvent] });

    expect(markup).toContain("revised this change request");
  });

  it("ignores non-revision change_request.updated bookkeeping", () => {
    const markup = renderReview(false, "member", {
      auditEvents: [{ ...revisionEvent, metadata: {} } as unknown as AuditEventVO],
    });

    expect(markup).not.toContain("revised this change request");
  });
});
