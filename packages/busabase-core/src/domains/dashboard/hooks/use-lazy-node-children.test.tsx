// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useLazyNodeChildren } from "./use-lazy-node-children";

afterEach(cleanup);

const node = (id: string, parentId: string | null, hasChildren = false): NodeVO =>
  ({
    id,
    parentId,
    type: "folder",
    slug: id,
    name: id,
    description: "",
    metadata: {},
    settings: {},
    explicitVisibility: null,
    icon: null,
    position: 0,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    baseId: null,
    children: [],
    hasChildren,
  }) as NodeVO;

const base = [{ ...node("root", null, true), children: [node("deep", "root", true)] }];
const deepChildren = [node("a", "deep"), node("b", "deep")];

const orpc = {
  nodes: {
    list: {
      queryOptions: ({ input }: { input: { parentId: string; depth: number } }) => ({
        queryKey: ["nodes", "list", input],
        queryFn: async () => (input.parentId === "deep" ? deepChildren : []),
      }),
    },
  },
} as unknown as Pick<BusabaseQueryUtils, "nodes">;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe("useLazyNodeChildren", () => {
  it("merges a lazily expanded folder's children into the tree", async () => {
    const { result } = renderHook(() => useLazyNodeChildren({ orpc, baseNodes: base }), {
      wrapper,
    });
    act(() => result.current.onExpandNode("deep"));
    await waitFor(() =>
      expect(result.current.nodes[0]?.children[0]?.children.map((n) => n.id)).toEqual(["a", "b"]),
    );
  });

  it("returns the same tree on a re-render where nothing changed", async () => {
    // A new tree per render looped mobile's drawer: an effect wrote the tree
    // to an observable cache, whose update re-rendered the drawer, which
    // produced another new tree.
    const { result, rerender } = renderHook(() => useLazyNodeChildren({ orpc, baseNodes: base }), {
      wrapper,
    });
    act(() => result.current.onExpandNode("deep"));
    await waitFor(() => expect(result.current.nodes[0]?.children[0]?.children).toHaveLength(2));
    const settled = result.current.nodes;
    rerender();
    rerender();
    expect(result.current.nodes).toBe(settled);
  });

  it("fetches nothing without a connection", () => {
    const { result } = renderHook(() => useLazyNodeChildren({ orpc: null, baseNodes: base }), {
      wrapper,
    });
    act(() => result.current.onExpandNode("deep"));
    expect(result.current.nodes).toBe(base);
    expect(result.current.loadingNodeIds.size).toBe(0);
  });
});
