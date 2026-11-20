import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  applyOptimisticViewReorder,
  isDefaultViewSettingsSettled,
  isOnlyRemainingView,
  resolveDefaultViewPath,
  sortViewsByPosition,
} from "./view-order";

const view = (id: string, position: number, createdAt: string, baseId = "bse_1") => ({
  baseId,
  createdAt,
  id,
  position,
  slug: `${id}-slug`,
});

describe("default-view settings readiness", () => {
  it("waits for saved settings when returning to a bare Base with an invalidated cache", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = ["nodes", "get", "tasks"];
    queryClient.setQueryData(queryKey, { defaultViewSlug: null as string | null });
    let finishFetch!: (settings: { defaultViewSlug: string }) => void;
    const freshSettings = new Promise<{ defaultViewSlug: string }>((resolve) => {
      finishFetch = resolve;
    });
    const options = { queryKey, queryFn: () => freshSettings, enabled: false };
    const observer = new QueryObserver(queryClient, options);
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      // The settings query is disabled while a view is open. Save invalidates
      // it there; navigating to the bare Base enables a background refetch.
      await queryClient.invalidateQueries({ queryKey });
      observer.setOptions({ ...options, enabled: true });
      const loading = observer.getCurrentResult();
      expect(loading.isFetched).toBe(true);
      expect(loading.isFetching).toBe(true);
      expect(isDefaultViewSettingsSettled(loading)).toBe(false);

      finishFetch({ defaultViewSlug: "review-slug" });
      await vi.waitFor(() => expect(observer.getCurrentResult().isFetching).toBe(false));
      const ready = observer.getCurrentResult();
      expect(isDefaultViewSettingsSettled(ready)).toBe(true);
      expect(
        resolveDefaultViewPath({
          baseSlug: "tasks",
          defaultViewSlug: ready.data?.defaultViewSlug,
          views: [
            view("grid", 0, "2026-01-01T00:00:00.000Z"),
            view("review", 1, "2026-01-01T00:00:00.000Z"),
          ],
        }),
      ).toBe("/base/tasks/review-slug");
    } finally {
      unsubscribe();
      queryClient.clear();
    }
  });
});

describe("sortViewsByPosition", () => {
  it("orders by position, then creation time, then id", () => {
    const sorted = sortViewsByPosition([
      view("c", 1, "2026-01-01T00:00:00.000Z"),
      view("b", 0, "2026-01-03T00:00:00.000Z"),
      view("a", 1, "2026-01-01T00:00:00.000Z"),
      view("d", 0, "2026-01-02T00:00:00.000Z"),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["d", "b", "a", "c"]);
  });

  it("does not mutate its input", () => {
    const input = [
      view("b", 1, "2026-01-01T00:00:00.000Z"),
      view("a", 0, "2026-01-01T00:00:00.000Z"),
    ];
    sortViewsByPosition(input);
    expect(input.map((item) => item.id)).toEqual(["b", "a"]);
  });
});

describe("resolveDefaultViewPath", () => {
  it("opens the leftmost view, not the first one listed", () => {
    expect(
      resolveDefaultViewPath({
        baseSlug: "tasks",
        views: [
          view("grid", 1, "2026-01-01T00:00:00.000Z"),
          view("board", 0, "2026-02-01T00:00:00.000Z"),
        ],
      }),
    ).toBe("/base/tasks/board-slug");
  });

  it("keeps the current query string, with or without a leading ?", () => {
    const views = [view("grid", 0, "2026-01-01T00:00:00.000Z")];
    expect(resolveDefaultViewPath({ baseSlug: "tasks", search: "space=tnl_1&demo", views })).toBe(
      "/base/tasks/grid-slug?space=tnl_1&demo",
    );
    expect(resolveDefaultViewPath({ baseSlug: "tasks", search: "?page=2", views })).toBe(
      "/base/tasks/grid-slug?page=2",
    );
  });

  it("returns null when the Base has no views, so the caller keeps the plain grid", () => {
    expect(resolveDefaultViewPath({ baseSlug: "tasks", views: [] })).toBeNull();
  });

  it("returns null without a Base slug", () => {
    expect(
      resolveDefaultViewPath({
        baseSlug: "",
        views: [view("grid", 0, "2026-01-01T00:00:00.000Z")],
      }),
    ).toBeNull();
  });

  it("opens settings.defaultViewSlug when that view is active, ahead of tab order", () => {
    const views = [
      view("grid", 0, "2026-01-01T00:00:00.000Z"),
      view("board", 1, "2026-02-01T00:00:00.000Z"),
    ];
    expect(
      resolveDefaultViewPath({ baseSlug: "tasks", defaultViewSlug: "board-slug", views }),
    ).toBe("/base/tasks/board-slug");
    expect(
      resolveDefaultViewPath({
        baseSlug: "tasks",
        defaultViewSlug: "board-slug",
        search: "space=tnl_1",
        views,
      }),
    ).toBe("/base/tasks/board-slug?space=tnl_1");
  });

  it("ignores a default that names no active view and opens the leftmost tab", () => {
    const views = [view("grid", 0, "2026-01-01T00:00:00.000Z")];
    expect(resolveDefaultViewPath({ baseSlug: "tasks", defaultViewSlug: "missing", views })).toBe(
      "/base/tasks/grid-slug",
    );
    expect(resolveDefaultViewPath({ baseSlug: "tasks", defaultViewSlug: null, views })).toBe(
      "/base/tasks/grid-slug",
    );
  });
});

describe("applyOptimisticViewReorder", () => {
  const views = [
    view("a", 0, "2026-01-01T00:00:00.000Z"),
    view("b", 1, "2026-01-02T00:00:00.000Z"),
    view("c", 2, "2026-01-03T00:00:00.000Z"),
    view("other", 0, "2026-01-01T00:00:00.000Z", "bse_2"),
  ];
  const order = (items: typeof views, baseId = "bse_1") =>
    sortViewsByPosition(items.filter((item) => item.baseId === baseId)).map((item) => item.id);

  it("moves a view to the front and renumbers its Base 0..n-1", () => {
    const next = applyOptimisticViewReorder(views, "c", 0);
    expect(order(next)).toEqual(["c", "a", "b"]);
    expect(
      next
        .filter((item) => item.baseId === "bse_1")
        .map((item) => item.position)
        .sort(),
    ).toEqual([0, 1, 2]);
  });

  it("moves a view later, like arrayMove", () => {
    expect(order(applyOptimisticViewReorder(views, "a", 1))).toEqual(["b", "a", "c"]);
    expect(order(applyOptimisticViewReorder(views, "a", 2))).toEqual(["b", "c", "a"]);
  });

  it("clamps out-of-range positions to the end", () => {
    expect(order(applyOptimisticViewReorder(views, "a", 99))).toEqual(["b", "c", "a"]);
    expect(order(applyOptimisticViewReorder(views, "c", -3))).toEqual(["c", "a", "b"]);
  });

  it("leaves other Bases' views and unknown ids alone", () => {
    const next = applyOptimisticViewReorder(views, "c", 0);
    expect(next.find((item) => item.id === "other")).toBe(views[3]);
    expect(applyOptimisticViewReorder(views, "missing", 0)).toEqual(views);
  });

  it("normalizes tied positions from older data", () => {
    const tied = [
      view("a", 0, "2026-01-01T00:00:00.000Z"),
      view("b", 0, "2026-01-02T00:00:00.000Z"),
      view("c", 0, "2026-01-03T00:00:00.000Z"),
    ];
    const next = applyOptimisticViewReorder(tied, "c", 1);
    expect(order(next)).toEqual(["a", "c", "b"]);
  });
});

describe("isOnlyRemainingView", () => {
  it("is true only for the last view of its Base", () => {
    const only = view("a", 0, "2026-01-01T00:00:00.000Z");
    const elsewhere = view("x", 0, "2026-01-01T00:00:00.000Z", "bse_2");
    expect(isOnlyRemainingView([only, elsewhere], only)).toBe(true);
    expect(isOnlyRemainingView([only, view("b", 1, "2026-01-02T00:00:00.000Z")], only)).toBe(false);
  });
});
