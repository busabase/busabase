import type { BaseFieldVO, ChangeRequestVO, FieldType, OperationVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  getFieldOrderDiffModel,
  isFieldReorderOperation,
} from "../src/domains/dashboard/helpers/operation-diff";

const timestamp = "2026-07-03T00:00:00.000Z";

const makeField = (id: string, slug: string, position: number): BaseFieldVO => ({
  id,
  baseId: "bse_blog",
  slug,
  name: slug,
  type: "text" as FieldType,
  required: false,
  position,
  options: {},
});

const makeOperation = (fieldIds: string[]): OperationVO => ({
  id: "opr_reorder",
  changeRequestId: "crq_reorder",
  baseId: "bse_blog",
  targetType: "base",
  nodeId: null,
  operation: "base_reorder_fields",
  status: "pending",
  targetRecordId: null,
  targetViewId: null,
  filePath: null,
  sourceRecordId: null,
  sourceCommitId: null,
  baseCommitId: null,
  headCommitId: "cmt_reorder",
  deleteMode: "archive",
  mergedRecordId: null,
  mergedViewId: null,
  position: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
  headCommit: {
    id: "cmt_reorder",
    baseId: "bse_blog",
    targetType: "base",
    nodeId: null,
    operationId: "opr_reorder",
    parentCommitId: null,
    fields: { fieldIds },
    operation: "base_reorder_fields",
    message: "Reorder fields",
    author: "tester",
    createdAt: timestamp,
  },
  baseFields: null,
});

const makeChangeRequest = (fields: BaseFieldVO[], operation: OperationVO): ChangeRequestVO => ({
  id: "crq_reorder",
  baseId: "bse_blog",
  targetType: "base",
  nodeId: null,
  status: "in_review",
  submittedBy: "tester",
  sourceMeta: {},
  reviewPolicySnapshot: {},
  mergeSummary: {},
  rejectedReason: null,
  reviewedAt: null,
  mergedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  base: {
    id: "bse_blog",
    nodeId: "nod_blog",
    slug: "blog",
    name: "Blog",
    description: "",
    reviewPolicy: { kind: "single", requiredApprovals: 1 },
    createdAt: timestamp,
    fields,
  },
  node: null,
  operations: [operation],
  primaryOperation: operation,
  operationCount: 1,
  reviews: [],
});

describe("operation diff field reorder model", () => {
  it("describes reorder fields operations as before and after field ids", () => {
    const fields = [
      makeField("fld_title", "title", 0),
      makeField("fld_slug", "slug", 1),
      makeField("fld_body", "body", 2),
    ];
    const operation = makeOperation(["fld_slug", "fld_title", "fld_body"]);
    const changeRequest = makeChangeRequest(fields, operation);

    const model = getFieldOrderDiffModel(changeRequest, operation);

    expect(isFieldReorderOperation(operation)).toBe(true);
    expect(model.beforeIds).toEqual(["fld_title", "fld_slug", "fld_body"]);
    expect(model.afterIds).toEqual(["fld_slug", "fld_title", "fld_body"]);
    expect([...model.movedIds].sort()).toEqual(["fld_slug", "fld_title"]);
    expect(model.fieldsById.get("fld_slug")?.slug).toBe("slug");
  });
});
