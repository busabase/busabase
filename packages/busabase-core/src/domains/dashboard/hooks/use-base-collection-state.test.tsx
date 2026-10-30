// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocation, useSearch } from "wouter";
import { readRecordPagination, writeRecordPagination } from "../helpers/record-pagination-url";
import { useBaseCollectionState } from "./use-base-collection-state";
import { useDashboardRoutes } from "./use-dashboard-routes";

afterEach(cleanup);

// Keep real route parsing and browser history. Only the already-resolved Base
// and view metadata are supplied here; browser acceptance exercises loading too.
function useCollectionRoute() {
  const [path, navigate] = useLocation();
  const search = useSearch();
  const routes = useDashboardRoutes();
  const baseId = routes.selectedBaseSlug;
  const viewId = ["grid", "board"].find(
    (view) =>
      routes.baseChildParams?.childId === view || routes.baseChildParams?.childId === `viw_${view}`,
  );
  const onPaginationChange = useCallback(
    (page: number, pageSize: 25 | 50 | 100, replace: boolean) =>
      navigate(`${path}?${writeRecordPagination(search, { page, pageSize })}`, { replace }),
    [navigate, path, search],
  );
  const pagination = readRecordPagination(search);
  const state = useBaseCollectionState({
    identity: "workspace:owner",
    scope: baseId && (viewId || routes.baseParams) ? `${baseId}:${viewId ?? "all"}` : null,
    search,
    pagination,
    onPaginationChange,
  });
  return { path, search, pagination, navigate, state };
}

describe("collection pagination across record navigation", () => {
  it.each(["rec_task", "rec_task/edit"])(
    "preserves page two when opening %s and using browser Back",
    async (recordPath) => {
      window.history.replaceState(
        null,
        "",
        "/base/tasks/grid?recordPage=2&recordPageSize=25&space=remote",
      );
      const { result } = renderHook(useCollectionRoute);
      expect(result.current.pagination.page).toBe(2);
      const snapshot = result.current.state;
      expect(snapshot).toBeDefined();
      if (!snapshot) throw new Error("Collection snapshot missing");
      snapshot.selectedRecordIds = ["rec_task"];
      snapshot.scrollTop = 350;
      snapshot.scrollLeft = 90;
      act(() => result.current.navigate(`/base/tasks/${recordPath}?${result.current.search}`));
      expect(result.current.pagination.page).toBe(2);
      expect(result.current.state).toBeUndefined();
      act(() => window.history.back());
      await waitFor(() => expect(result.current.path).toBe("/base/tasks/grid"));
      expect(result.current.pagination).toEqual({ page: 2, pageSize: 25 });
      expect(new URLSearchParams(result.current.search).get("space")).toBe("remote");
      expect(result.current.state).toBe(snapshot);
      expect(result.current.state?.selectedRecordIds).toEqual(["rec_task"]);
      expect(result.current.state?.scrollTop).toBe(350);
      expect(result.current.state?.scrollLeft).toBe(90);
    },
  );

  it.each(["/base/tasks/board", "/base/customers/grid"])(
    "resets only an actual collection switch to %s",
    (destination) => {
      window.history.replaceState(
        null,
        "",
        "/base/tasks/grid?recordPage=2&recordPageSize=25&space=remote",
      );
      const { result } = renderHook(useCollectionRoute);
      const snapshot = result.current.state;
      act(() => result.current.navigate(`${destination}?${result.current.search}`));
      expect(result.current.pagination).toEqual({ page: 1, pageSize: 25 });
      expect(new URLSearchParams(result.current.search).get("space")).toBe("remote");
      expect(result.current.state).not.toBe(snapshot);
      expect(result.current.state?.selectedRecordIds).toEqual([]);
    },
  );

  it("uses the view's identity when its slug and id address the same collection", () => {
    window.history.replaceState(null, "", "/base/tasks/grid?recordPage=2");
    const { result } = renderHook(useCollectionRoute);
    const snapshot = result.current.state;
    act(() => result.current.navigate(`/base/tasks/viw_grid?${result.current.search}`));
    expect(result.current.pagination.page).toBe(2);
    expect(result.current.state).toBe(snapshot);
  });
});

describe("collection snapshot boundaries", () => {
  const initial = {
    identity: "space-a:owner",
    scope: "tasks:grid" as string | null,
    search: "recordPage=2",
    pagination: { page: 2, pageSize: 25 as const },
    onPaginationChange: vi.fn(),
  };

  it("preserves an initial deep link while a bare Base resolves its default view", () => {
    const onPaginationChange = vi.fn();
    const { result, rerender } = renderHook(useBaseCollectionState, {
      initialProps: { ...initial, scope: null as string | null, onPaginationChange },
    });
    expect(result.current).toBeUndefined();
    rerender({ ...initial, scope: "tasks:grid", onPaginationChange });
    expect(onPaginationChange).not.toHaveBeenCalled();
    expect(result.current?.scope).toContain("recordPage=2");
  });

  it.each([
    { ...initial, identity: "space-a:other-user" },
    { ...initial, identity: "space-b:owner" },
    { ...initial, search: "recordPage=3" },
    { ...initial, scope: "tasks:board" },
  ])("clears selection and scroll when the identity or collection/query changes", (next) => {
    const { result, rerender } = renderHook(useBaseCollectionState, { initialProps: initial });
    const snapshot = result.current;
    if (!snapshot) throw new Error("Collection snapshot missing");
    snapshot.selectedRecordIds = ["rec_task"];
    snapshot.scrollTop = 350;
    snapshot.scrollLeft = 90;
    rerender(next);
    expect(result.current).not.toBe(snapshot);
    expect(result.current?.selectedRecordIds).toEqual([]);
    expect(result.current?.scrollTop).toBe(0);
    expect(result.current?.scrollLeft).toBe(0);
  });

  it("does not revive an old account's selection after identity changes on a record page", () => {
    const { result, rerender } = renderHook(useBaseCollectionState, { initialProps: initial });
    const snapshot = result.current;
    if (!snapshot) throw new Error("Collection snapshot missing");
    snapshot.selectedRecordIds = ["rec_task"];
    rerender({ ...initial, identity: "other:owner", scope: null });
    rerender(initial);
    expect(result.current).not.toBe(snapshot);
    expect(result.current?.selectedRecordIds).toEqual([]);
  });
});
