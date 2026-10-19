/** The record and owning Base a record-detail capability may address. */
export interface BusabaseEmbedRecordScope {
  recordId: string;
  baseId: string;
  baseNodeId: string;
  baseSlug: string;
}

/** A record preview needs its record, route state and Base view metadata only. */
export function isRecordEmbedProcedureAllowed(
  path: readonly string[],
  input: unknown,
  scope: BusabaseEmbedRecordScope,
): boolean {
  if (typeof input !== "object" || input === null) return false;
  const args = input as Record<string, unknown>;
  const key = path.slice(-2).join(".");
  if (key === "records.get") return args.recordId === scope.recordId;
  if (key === "bases.listViews") return args.baseId === scope.baseId;
  if (key === "nodes.resolveRouteState") {
    return (
      (args.type === undefined || args.type === "base") &&
      (args.nodeId === scope.baseNodeId ||
        args.nodeId === scope.baseId ||
        args.nodeId === scope.baseSlug)
    );
  }
  return false;
}
