/** Leave room below Next's default 2 MiB per-entry limit for its cache metadata. */
export const SUMMARY_CACHE_BUDGET_BYTES = Math.floor(1.9 * 1024 * 1024);

/** Include the escaped JSON body that Next stores, not just the original array's JSON. */
export const measureSummaryCacheEntryBytes = (items: readonly unknown[]): number =>
  new TextEncoder().encode(
    JSON.stringify({
      kind: "FETCH",
      data: { headers: {}, body: JSON.stringify(items), status: 200, url: "" },
      revalidate: 31_536_000,
    }),
  ).byteLength;

/** Warn before cache writes start failing; valid content and custom metadata remain readable. */
export const warnOnSummaryCacheBudget = (
  items: readonly unknown[],
  kind: "posts" | "pages",
): void => {
  const serializedBytes = measureSummaryCacheEntryBytes(items);
  if (serializedBytes < SUMMARY_CACHE_BUDGET_BYTES) return;
  // Deliberately exclude records, cache namespaces, URLs and upstream error details.
  console.warn("[busabase-cms] Summary cache is approaching Next's default entry limit", {
    kind,
    recordCount: items.length,
    serializedBytes,
    budgetBytes: SUMMARY_CACHE_BUDGET_BYTES,
  });
};
