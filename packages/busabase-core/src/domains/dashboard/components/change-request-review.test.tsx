import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AuditEventVO, ChangeRequestVO } from "busabase-contract/types";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { DashboardOrpcProvider } from "../orpc-context";
import { type DashboardVisitorKind, DashboardVisitorProvider } from "../visitor-context";
import { ChangeRequestReviewLayout, reviewConversionPreviewState } from "./change-request-review";
import { FieldConversionPreview } from "./field-conversion-preview";

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
  overrides: {
    auditEvents?: AuditEventVO[];
    changeRequest?: ChangeRequestVO;
    orpc?: BusabaseQueryUtils;
  } = {},
) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Router hook={useStaticLocation} searchHook={useStaticSearch}>
        <CoreI18nProvider locale="en">
          <DashboardOrpcProvider orpc={overrides.orpc}>
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
          </DashboardOrpcProvider>
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

// ---------------------------------------------------------------------------
// Convert-field impact, re-checked at review time.
//
// Nothing locks the column between submit and merge, so the approver must read a
// FRESH dry run rather than whatever the submitter saw. The two things that make
// it honest: the headline count is derived (`total - convertible - null`), never
// `conflicts.length` — the server caps that sample at 100 — and the dry run is
// run with the operation's own `selectChoiceMode`, which changes the answer.
// ---------------------------------------------------------------------------

const stageField = {
  id: "fld_stage",
  baseId: "bas_customers",
  slug: "stage",
  name: "Stage",
  type: "text",
  required: false,
  position: 0,
  options: {},
} satisfies NonNullable<ChangeRequestVO["base"]>["fields"][number];

const convertOperation = {
  ...operation,
  id: "opr_convert",
  operation: "base_convert_field",
  targetRecordId: null,
  baseFields: null,
  headCommit: {
    ...operation.headCommit,
    id: "cmt_convert",
    operationId: "opr_convert",
    operation: "base_convert_field",
    payload: {
      fieldId: "fld_stage",
      slug: "stage",
      fromType: "text",
      newType: "select",
      selectChoiceMode: "auto_create",
      choices: [],
    },
    message: "Convert field stage from text to select",
  },
} satisfies ChangeRequestVO["operations"][number];

const convertChangeRequest = {
  ...changeRequest,
  operations: [convertOperation],
  primaryOperation: convertOperation,
  base: { ...changeRequest.base, fields: [stageField] },
} satisfies ChangeRequestVO;

/** 500 rows, 300 convert, 0 empty → 200 cleared, while the sample stops at 100. */
const cappedPreview = {
  totalCount: 500,
  convertibleCount: 300,
  nullCount: 0,
  conflicts: Array.from({ length: 100 }, (_, index) => ({
    recordId: `rec_${index}`,
    currentValue: `unmatched-${index}`,
  })),
};

const stubOrpc = (data: unknown, calls: Array<Record<string, unknown>> = []) =>
  ({
    bases: {
      previewFieldConversion: {
        queryOptions: ({ input }: { input: Record<string, unknown> }) => {
          calls.push(input);
          return {
            queryKey: ["preview", input],
            queryFn: async () => data,
            initialData: data,
          };
        },
      },
    },
  }) as unknown as BusabaseQueryUtils;

describe("Convert-field impact on the review page", () => {
  it("does not present cached counts as fresh while the review-time refetch is running", () => {
    const markup = renderReview(false, "member", {
      changeRequest: convertChangeRequest,
      orpc: stubOrpc(cappedPreview),
    });

    expect(markup).toContain("Checking every value");
    expect(markup).not.toContain("200 values will be cleared");
    expect(markup).not.toContain("Checked just now against the column");
  });

  it("runs the dry run with the operation's own selectChoiceMode", () => {
    const calls: Array<Record<string, unknown>> = [];
    renderReview(false, "member", {
      changeRequest: convertChangeRequest,
      orpc: stubOrpc(cappedPreview, calls),
    });

    expect(calls[0]).toEqual({
      baseId: "bas_customers",
      fieldId: "fld_stage",
      newType: "select",
      selectChoiceMode: "auto_create",
    });
  });

  it("labels only a settled successful result as computed now", () => {
    const refreshing = reviewConversionPreviewState({
      data: cappedPreview,
      error: null,
      isFetching: true,
      isPending: false,
    });
    expect(refreshing.preview.data).toBeUndefined();
    expect(refreshing.preview.isPending).toBe(true);
    expect(refreshing.checkedNow).toBe(false);

    const settled = reviewConversionPreviewState({
      data: cappedPreview,
      error: null,
      isFetching: false,
      isPending: false,
    });
    expect(settled.preview.data).toBe(cappedPreview);
    expect(settled.preview.isPending).toBe(false);
    expect(settled.checkedNow).toBe(true);

    const failed = reviewConversionPreviewState({
      data: cappedPreview,
      error: new Error("refresh failed"),
      isFetching: false,
      isPending: false,
    });
    expect(failed.checkedNow).toBe(false);
    expect(failed.preview.error).toEqual(new Error("refresh failed"));
  });

  it.each(["merged", "rejected", "abandoned"])(
    "skips the dry run once the change request is %s",
    (status) => {
      const calls: Array<Record<string, unknown>> = [];
      const markup = renderReview(false, "member", {
        changeRequest: { ...convertChangeRequest, status } as ChangeRequestVO,
        orpc: stubOrpc(cappedPreview, calls),
      });

      expect(markup).not.toContain('data-testid="convert-field-impact"');
      expect(markup).not.toContain("values will be cleared");
      expect(calls).toEqual([]);
    },
  );

  it("leaves a non-convert operation alone", () => {
    const markup = renderReview(false, "member", { orpc: stubOrpc(cappedPreview) });

    expect(markup).not.toContain('data-testid="convert-field-impact"');
  });

  it("degrades to the stored operation when no host wired orpc", () => {
    const markup = renderReview(false, "member", { changeRequest: convertChangeRequest });

    expect(markup).not.toContain('data-testid="convert-field-impact"');
  });
});

describe("Failed dry run", () => {
  const renderPanel = (preview: Parameters<typeof FieldConversionPreview>[0]["preview"]) =>
    renderToStaticMarkup(
      <Router hook={useStaticLocation} searchHook={useStaticSearch}>
        <CoreI18nProvider locale="en">
          <FieldConversionPreview field={stageField} preview={preview} />
        </CoreI18nProvider>
      </Router>,
    );

  it("says the check failed rather than showing an empty, reassuring panel", () => {
    const markup = renderPanel({
      data: undefined,
      error: new Error("Field not found: fld_stage"),
      isPending: false,
    });

    expect(markup).toContain("Field not found: fld_stage");
    expect(markup).not.toContain("Every value survives this change.");
    expect(markup).not.toContain("values will be cleared");
  });

  it("still renders the counts on a successful check", () => {
    const markup = renderPanel({ data: cappedPreview, error: null, isPending: false });

    expect(markup).toContain("200 values will be cleared");
    expect(markup).not.toContain("100 values will be cleared");
    expect(markup).toContain("500 values · 300 convert · 0 already empty");
    expect(markup).toContain("Showing 10 of 200.");
  });
});
