import { QueryClient } from "@tanstack/react-query";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { describe, expect, it } from "vitest";

/**
 * The Assets gallery pages with `useInfiniteQuery`, whose key carries
 * `{ input, type: "infinite" }`. An invalidation built from
 * `assets.list.queryOptions({}).queryKey` pins `type: "query"` and therefore
 * matches nothing — a deleted or renamed asset stayed on screen.
 *
 * The fix is to invalidate the procedure-level `assets.list.key()`, which has no
 * `type` and matches every call shape. This pins that behaviour so it is not
 * quietly reverted; see the review on PR #8385.
 */
describe("assets.list invalidation covers the paged gallery", () => {
  const orpc = createBusabaseQueryUtils();
  const galleryKey = (limit: number) =>
    orpc.assets.list.infiniteOptions({
      input: () => ({ limit }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: () => undefined,
    }).queryKey;

  it("invalidates an infinite gallery query through the procedure key", async () => {
    const queryClient = new QueryClient();
    const key = galleryKey(200);
    queryClient.setQueryData(key, { pages: [[]], pageParams: [undefined] });

    await queryClient.invalidateQueries({ queryKey: orpc.assets.list.key() });

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it("would NOT have matched with the old queryOptions key", async () => {
    // Kept as executable documentation of the bug: a `queryOptions` key pins
    // `type: "query"`, so the infinite query survives the invalidation.
    const queryClient = new QueryClient();
    const key = galleryKey(200);
    queryClient.setQueryData(key, { pages: [[]], pageParams: [undefined] });

    await queryClient.invalidateQueries({
      queryKey: orpc.assets.list.queryOptions({}).queryKey,
    });

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
  });
});
