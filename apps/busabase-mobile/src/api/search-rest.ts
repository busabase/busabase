import type { SearchResponseVO } from "busabase-core/types";

/**
 * The Busabase server serves search as a plain GET (query/limit/offset params,
 * bare JSON body) rather than through the oRPC protocol, so call it directly.
 */
export async function searchBusabaseRest(
  serverUrl: string,
  options: { query: string; limit?: number; offset?: number },
): Promise<SearchResponseVO> {
  const base = serverUrl.replace(/\/+$/, "");
  const params = new URLSearchParams({ query: options.query });
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  const response = await fetch(`${base}/api/v1/search?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Server responded ${response.status}`);
  }
  return (await response.json()) as SearchResponseVO;
}
