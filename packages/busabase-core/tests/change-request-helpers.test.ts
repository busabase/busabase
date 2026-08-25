import type { ChangeRequestVO, OperationVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  getChangeRequestBrief,
  getChangeRequestRiskHints,
  getChangeRequestSummary,
  getOperationImpact,
  getOperationLabel,
} from "../src/domains/dashboard/helpers/change-request";
import {
  LIST_OMITTED_FIELD_VALUE,
  LIST_OMITTED_LONG_TEXT_VALUE,
} from "../src/domains/dashboard/utils/list-payload-preview";

const makeOperation = (overrides: Partial<OperationVO>): OperationVO => ({
  id: "opr_1",
  changeRequestId: "crq_1",
  baseId: null,
  targetType: "node",
  nodeId: null,
  operation: "node_create",
  status: "pending",
  targetRecordId: null,
  targetViewId: null,
  filePath: null,
  sourceRecordId: null,
  sourceCommitId: null,
  baseCommitId: null,
  headCommitId: "cmt_1",
  deleteMode: "archive",
  mergedRecordId: null,
  mergedViewId: null,
  position: 0,
  createdAt: "2026-07-02T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
  headCommit: {
    id: "cmt_1",
    baseId: null,
    targetType: "node",
    nodeId: null,
    operationId: "opr_1",
    parentCommitId: null,
    payload: {},
    operation: "node_create",
    message: "Create folder",
    author: "tester",
    createdAt: "2026-07-02T00:00:00.000Z",
  },
  baseFields: null,
  ...overrides,
});

const makeChangeRequest = (operations: OperationVO[]): ChangeRequestVO => ({
  id: "crq_1",
  baseId: null,
  targetType: "node",
  nodeId: null,
  status: "in_review",
  submittedBy: "tester",
  sourceMeta: { subject: "node_tree" },
  reviewPolicySnapshot: {},
  mergeSummary: {},
  rejectedReason: null,
  reviewedAt: null,
  mergedAt: null,
  createdAt: "2026-07-02T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
  base: null,
  node: null,
  operations,
  primaryOperation: operations[0] ?? null,
  operationCount: operations.length,
  reviews: [],
});

describe("change request dashboard helpers", () => {
  it("labels folder creation operations by node type", () => {
    const first = makeOperation({
      headCommit: {
        ...makeOperation({}).headCommit,
        payload: { kind: "create", nodeType: "folder", slug: "crm", name: "CRM" },
      },
    });
    const second = makeOperation({
      id: "opr_2",
      headCommitId: "cmt_2",
      position: 1,
      headCommit: {
        ...makeOperation({}).headCommit,
        id: "cmt_2",
        operationId: "opr_2",
        payload: { kind: "create", nodeType: "folder", slug: "products", name: "Products" },
      },
    });

    expect(getOperationLabel(first)).toBe("Create folder");
    expect(getOperationImpact(first)).toBe("Creates folder");
    expect(getChangeRequestSummary(makeChangeRequest([first, second]))).toBe("2 create folder");
    expect(getChangeRequestBrief(makeChangeRequest([first, second]))).toBe(
      "2 operations in Node tree: 2 create folder.",
    );
  });

  it("keeps the long-text risk hint when a list preview omits the value", () => {
    const operation = makeOperation({
      operation: "record_update",
      headCommit: {
        ...makeOperation({}).headCommit,
        operation: "record_update",
        payload: { body: LIST_OMITTED_LONG_TEXT_VALUE },
      },
    });

    expect(getChangeRequestRiskHints(makeChangeRequest([operation]))).toContain("long text");
  });

  it("does not label an omitted object as long text", () => {
    const operation = makeOperation({
      operation: "record_update",
      headCommit: {
        ...makeOperation({}).headCommit,
        operation: "record_update",
        payload: { config: LIST_OMITTED_FIELD_VALUE },
      },
    });

    expect(getChangeRequestRiskHints(makeChangeRequest([operation]))).not.toContain("long text");
  });
});
