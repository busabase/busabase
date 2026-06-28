import type { RecordVO, ViewConfigVO, ViewFilterVO } from "busabase-core/types";
import { stringifyFieldValue } from "./busabase-display";

function recordMatchesFilter(record: RecordVO, filter: ViewFilterVO): boolean {
  const value = record.headCommit.fields[filter.fieldSlug];
  const text = stringifyFieldValue(value).toLowerCase();
  const expected = stringifyFieldValue(filter.value).toLowerCase();

  switch (filter.operator) {
    case "contains":
      return text.includes(expected);
    case "equals":
      return text === expected;
    case "not_empty":
      return text.length > 0;
    case "is_empty":
      return text.length === 0;
    case "is_true":
      return value === true || value === "true";
    case "is_false":
      return value === false || value === "false" || value === null || value === undefined;
    default:
      return true;
  }
}

export function applyViewConfig(records: RecordVO[], config?: ViewConfigVO | null): RecordVO[] {
  if (!config) {
    return records;
  }
  const filtered = records.filter((record) =>
    config.filters.every((filter) => recordMatchesFilter(record, filter)),
  );
  return [...filtered].sort((left, right) => {
    for (const sort of config.sorts) {
      const a = stringifyFieldValue(left.headCommit.fields[sort.fieldSlug]);
      const b = stringifyFieldValue(right.headCommit.fields[sort.fieldSlug]);
      const result = a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
      if (result !== 0) {
        return sort.direction === "asc" ? result : -result;
      }
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}
