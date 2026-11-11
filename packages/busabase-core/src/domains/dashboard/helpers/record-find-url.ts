export interface RecordFindState {
  query: string;
  fieldId: string;
}

export const RECORD_FIND_QUERY_LIMIT = 500;

/** The scope marker keeps forward navigation from carrying a find into another view. */
export function readRecordFind(search: string, scope?: string | null): RecordFindState {
  const params = new URLSearchParams(search);
  const savedScope = params.get("recordFindScope");
  if (scope && savedScope && savedScope !== scope) return { query: "", fieldId: "" };
  return {
    query: (params.get("recordFind") ?? "").trim().slice(0, RECORD_FIND_QUERY_LIMIT),
    fieldId: params.get("recordFindField") ?? "",
  };
}

export function clearRecordFind(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("recordFind");
  params.delete("recordFindField");
  params.delete("recordFindScope");
  return params.toString();
}

export function writeRecordFind(search: string, value: RecordFindState, scope: string): string {
  const params = new URLSearchParams(clearRecordFind(search));
  const query = value.query.trim().slice(0, RECORD_FIND_QUERY_LIMIT);
  if (query) params.set("recordFind", query);
  if (value.fieldId) params.set("recordFindField", value.fieldId);
  if (query || value.fieldId) params.set("recordFindScope", scope);
  params.set("recordPage", "1");
  return params.toString();
}

export function hasStaleRecordFind(search: string, scope: string | null): boolean {
  const savedScope = new URLSearchParams(search).get("recordFindScope");
  return Boolean(scope && savedScope && savedScope !== scope);
}
