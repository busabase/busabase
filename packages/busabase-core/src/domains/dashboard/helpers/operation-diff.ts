import type { BaseFieldVO, ChangeRequestVO, OperationVO } from "busabase-contract/types";

export interface FieldOrderDiffModel {
  afterIds: string[];
  beforeIds: string[];
  fieldsById: Map<string, BaseFieldVO>;
  movedIds: Set<string>;
}

export const fieldOrderIds = (operation: OperationVO): string[] =>
  Array.isArray(operation.headCommit.fields.fieldIds)
    ? operation.headCommit.fields.fieldIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

export const sortedBaseFields = (changeRequest: ChangeRequestVO) =>
  (changeRequest.base?.fields ?? []).slice().sort((left, right) => left.position - right.position);

export const isFieldReorderOperation = (operation: OperationVO) =>
  operation.operation === "base_reorder_fields";

export const getFieldOrderDiffModel = (
  changeRequest: ChangeRequestVO,
  operation: OperationVO,
): FieldOrderDiffModel => {
  const beforeFields = sortedBaseFields(changeRequest);
  const beforeIds = beforeFields.map((field) => field.id);
  const afterIds = fieldOrderIds(operation);
  const fieldsById = new Map(beforeFields.map((field) => [field.id, field]));
  const beforePositionById = new Map(beforeIds.map((id, index) => [id, index]));
  const movedIds = new Set(afterIds.filter((id, index) => beforePositionById.get(id) !== index));

  return { afterIds, beforeIds, fieldsById, movedIds };
};
