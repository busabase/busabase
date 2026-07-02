import type { ChangeRequestVO, OperationVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  getChangeRequestBrief,
  getChangeRequestSummary,
  getOperationImpact,
  getOperationLabel,
} from "../src/domains/dashboard/helpers/change-request";

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
    fields: {},
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
        fields: { kind: "create", nodeType: "folder", slug: "crm", name: "CRM" },
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
        fields: { kind: "create", nodeType: "folder", slug: "products", name: "Products" },
      },
    });

    expect(getOperationLabel(first)).toBe("Create folder");
    expect(getOperationImpact(first)).toBe("Creates folder");
    expect(getChangeRequestSummary(makeChangeRequest([first, second]))).toBe("2 create folder");
    expect(getChangeRequestBrief(makeChangeRequest([first, second]))).toBe(
      "2 operations in Node tree: 2 create folder.",
    );
  });
});
