// @vitest-environment jsdom

import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { ChangeRequestVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNodeTree } from "./use-node-tree";

afterEach(cleanup);

describe("useNodeTree breadcrumb invalidation", () => {
  it.each([false, true])(
    "refreshes a visited descendant after a move (active: %s)",
    async (active) => {
      let parentName = "Old parent";
      const fetch = vi.fn(async (request: Request) => {
        const path = new URL(request.url).pathname;
        const data = path.endsWith("/nodes/ancestors")
          ? {
              ancestorIds: ["parent"],
              ancestors: [{ id: "parent", name: parentName, slug: "parent", type: "folder" }],
            }
          : [];
        return new Response(JSON.stringify({ json: data }), {
          headers: { "content-type": "application/json" },
        });
      });
      const orpc = createBusabaseQueryUtils(
        "http://localhost/api/rpc",
        { batch: false, fetch },
        "space-a",
      );
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const ancestorOptions = {
        ...orpc.nodes.ancestors.queryOptions({ input: { nodeId: "visited-doc", type: "doc" } }),
        staleTime: Number.POSITIVE_INFINITY,
      };
      await queryClient.fetchQuery(ancestorOptions);
      const observer = new QueryObserver(queryClient, ancestorOptions);
      const unsubscribe = active ? observer.subscribe(() => undefined) : () => undefined;
      const moveNode = vi.fn(async () => {
        parentName = "New parent";
        return { status: "merged" } as ChangeRequestVO;
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
      const { result, unmount } = renderHook(
        () => useNodeTree({ orpc, apiClient: { moveNode }, queryClient }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.nodesQuery.isSuccess).toBe(true));

      act(() => result.current.onMoveNode({ nodeId: "ancestor", parentNodeId: "destination" }));
      await waitFor(() => expect(moveNode).toHaveBeenCalledOnce());

      if (active) {
        await waitFor(() =>
          expect(queryClient.getQueryData(ancestorOptions.queryKey)).toMatchObject({
            ancestors: [{ name: "New parent" }],
          }),
        );
      } else {
        // An unmounted route must be stale, even with an infinite staleTime,
        // so returning to that descendant cannot reuse the old folder path.
        await waitFor(() =>
          expect(queryClient.getQueryState(ancestorOptions.queryKey)?.isInvalidated).toBe(true),
        );
        expect(await queryClient.fetchQuery(ancestorOptions)).toMatchObject({
          ancestors: [{ name: "New parent" }],
        });
      }
      unsubscribe();
      unmount();
      queryClient.clear();
    },
  );
});
