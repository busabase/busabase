// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { BaseVO, RecordVO } from "busabase-contract/types";
import { act, createElement, type ReactNode, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { getMobileQueryRecovery } from "~/domains/workspace/utils/mobile-query-recovery";
import { BaseCalendarView } from "../components/BaseCalendarView";
import { useBaseDetailController } from "./use-base-detail-controller";

const state = vi.hoisted(() => ({
  workspace: null as ReturnType<typeof import("~/api/use-busabase-orpc").useBusabaseOrpc>,
  queryClient: null as QueryClient | null,
}));

vi.mock("~/api/use-busabase-orpc", () => ({
  useBusabaseOrpc: () => state.workspace,
}));

vi.mock("~/domains/workspace/hooks/use-mobile-query-recovery", () => ({
  useMobileQueryRecovery: (keys: readonly unknown[][]) => {
    const token = useRef(Symbol("visible-calendar"));
    const keyHash = JSON.stringify(keys);
    useEffect(() => {
      if (!state.queryClient || !state.workspace) return;
      const recovery = getMobileQueryRecovery(state.queryClient, state.workspace.scopeKey);
      recovery.registerRoute(token.current, JSON.parse(keyHash));
      return () => recovery.unregisterRoute(token.current);
    }, [keyHash]);
    return true;
  },
}));

vi.mock("react-native", () => ({
  Pressable: ({ children }: { children: ReactNode }) => children,
  Text: ({ children }: { children: ReactNode }) => children,
  View: ({ children }: { children: ReactNode }) => children,
  StyleSheet: { create: (value: unknown) => value },
  Platform: { OS: "ios", select: (value: Record<string, unknown>) => value.ios ?? value.default },
}));
vi.mock("lucide-react-native", () => ({
  ChevronLeft: () => null,
  ChevronRight: () => null,
}));
vi.mock("~/components/native-screen", () => ({ NativeInlineError: () => null }));
vi.mock("~/theme/use-tokens", () => ({ useTokens: () => ({}) }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let client: QueryClient | undefined;

afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  root = undefined;
  client = undefined;
});

it("refreshes the displayed month without downloading the hidden ordinary record list", async () => {
  const scopeKey = "mobile:calendar-integration";
  const orpc = createBusabaseQueryUtils("/api/rpc", {}, scopeKey);
  const base = {
    id: "base-calendar",
    slug: "calendar",
    name: "Calendar",
    fields: [
      { id: "title", slug: "title", name: "Title", type: "text", options: {} },
      { id: "day", slug: "day", name: "Day", type: "date", options: {} },
    ],
  } as unknown as BaseVO;
  const view = {
    id: "view-calendar",
    name: "Calendar",
    type: "calendar",
    config: { dateFieldSlug: "day", sorts: [], filters: [] },
    createdAt: "2026-11-03T00:00:00.000Z",
  } as unknown as NonNullable<ReturnType<typeof useBaseDetailController>["activeView"]>;
  let title = "Before";
  const listPage = vi.fn(async () => ({
    records: [
      {
        id: "record-calendar",
        baseId: base.id,
        base,
        headCommit: { payload: { title, day: new Date().toISOString().slice(0, 10) } },
      } as unknown as RecordVO,
    ],
    page: 1,
    pageSize: 100,
    total: 1,
    totalPages: 1,
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.queryClient = client;
  state.workspace = {
    scopeKey,
    orpc,
    client: { records: { listPage } },
  } as unknown as NonNullable<typeof state.workspace>;
  client.setQueryDefaults(orpc.bases.list.key(), { queryFn: async () => [base] });
  client.setQueryData(orpc.bases.list.queryOptions({ input: {} }).queryKey, [base]);
  client.setQueryDefaults(orpc.bases.listViews.key(), { queryFn: async () => [view] });
  client.setQueryData(orpc.bases.listViews.queryOptions({ input: { baseId: base.id } }).queryKey, [
    view,
  ]);
  let controller!: ReturnType<typeof useBaseDetailController>;
  const Harness = () => {
    controller = useBaseDetailController(base.slug);
    return createElement(BaseCalendarView, {
      base: controller.base,
      activeView: controller.activeView,
      fields: controller.previewFields,
      onOpenRecord: () => undefined,
    });
  };
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root?.render(
      createElement(QueryClientProvider, { client: client as QueryClient }, createElement(Harness)),
    );
  });
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  await settle();
  await settle();
  expect(listPage).toHaveBeenCalledTimes(1);
  expect(listPage).toHaveBeenLastCalledWith(
    expect.objectContaining({ dateRange: expect.any(Object) }),
  );
  title = "After";
  act(() => controller.refresh());
  await settle();
  expect(listPage).toHaveBeenCalledTimes(2);
  const range = client.getQueryCache().findAll({ queryKey: [scopeKey, "base-calendar-range"] })[0];
  expect(
    (range.state.data as { pages: { records: RecordVO[] }[] }).pages[0].records[0].headCommit
      .payload.title,
  ).toBe("After");
});
