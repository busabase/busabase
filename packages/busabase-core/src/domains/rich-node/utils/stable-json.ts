/**
 * Key-order-independent JSON serialization, for comparing a document the
 * client holds against the same document read back from the server.
 *
 * A plain `JSON.stringify` can't do that job here: rich-node documents round
 * trip through a PostgreSQL `jsonb` column, and `jsonb` does not preserve
 * object key order — it stores keys sorted by length, then bytewise. So the
 * exact scene an editor just saved comes back with its keys shuffled
 * (`{"id","type","x"}` → `{"x","id","type"}`), and a naive string compare
 * reports "the server changed underneath me" on every single refetch. That
 * false positive is what would make `useServerDocumentSync` re-seed an editor
 * (resetting selection/undo) after every save.
 *
 * Arrays keep their order — element order is meaningful in every document this
 * is used on (Excalidraw z-order, workflow steps).
 */
const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return Object.fromEntries(entries.map(([key, entry]) => [key, sortValue(entry)]));
};

export const stableStringify = (value: unknown): string => JSON.stringify(sortValue(value));
