// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BaseVO, RecordVO } from "busabase-contract/types";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseCalendarView } from "../components/BaseCalendarView";
import { dayKey } from "../utils/calendar-grid";

const state = vi.hoisted(() => ({
  workspace: null as ReturnType<typeof import("~/api/use-busabase-orpc").useBusabaseOrpc>,
}));
vi.mock("~/api/use-busabase-orpc", () => ({ useBusabaseOrpc: () => state.workspace }));
vi.mock("~/domains/workspace/hooks/use-mobile-query-recovery", () => ({
  useMobileQueryRecovery: () => true,
}));
vi.mock("react-native", () => ({
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
    disabled,
  }: {
    children: ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
    disabled?: boolean;
  }) =>
    createElement(
      "button",
      { type: "button", onClick: onPress, "aria-label": accessibilityLabel, disabled },
      children,
    ),
  Text: ({ children }: { children: ReactNode }) => createElement("span", null, children),
  View: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  ScrollView: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  StyleSheet: { create: (value: unknown) => value },
  Platform: { OS: "ios", select: (value: Record<string, unknown>) => value.ios ?? value.default },
}));
vi.mock("lucide-react-native", () => ({ ChevronLeft: () => null, ChevronRight: () => null }));
vi.mock("~/components/native-screen", () => ({
  NativeInlineError: ({ message }: { message: string }) =>
    createElement("div", { role: "alert" }, message),
  NativeBottomSheet: ({
    children,
    title,
    onClose,
  }: {
    children: ReactNode;
    title: string;
    onClose: () => void;
  }) =>
    createElement(
      "section",
      { role: "dialog", "aria-label": title },
      createElement("button", { type: "button", onClick: onClose }, "Close day"),
      children,
    ),
}));
vi.mock("~/theme/use-tokens", () => ({ useTokens: () => ({}) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let client: QueryClient | undefined;
let container: HTMLDivElement;
const base = {
  id: "bas-calendar",
  slug: "calendar",
  name: "Calendar",
  fields: [
    { id: "title", slug: "title", name: "Title", type: "text", options: {} },
    { id: "due", slug: "due", name: "Due", type: "date", options: {} },
  ],
} as unknown as BaseVO;
const view = {
  id: "view-calendar",
  name: "Calendar",
  type: "calendar",
  config: { dateFieldSlug: "due", filters: [], sorts: [] },
} as unknown as NonNullable<Parameters<typeof BaseCalendarView>[0]["activeView"]>;
const busyDay = dayKey(new Date());
type Input = {
  dateRange: { gte: string; lt: string };
  page: number;
  pageSize: number;
  totalLimit?: number;
};
const record = (index: number) =>
  ({
    id: `record-${index}`,
    baseId: base.id,
    base,
    headCommit: { payload: { title: `Task ${index}`, due: busyDay } },
  }) as unknown as RecordVO;
const makeClient = (dayTotal: number, gridTotal = dayTotal) => {
  const listPage = vi.fn(async (input: Input) => {
    const isDay = Date.parse(input.dateRange.lt) - Date.parse(input.dateRange.gte) <= 86_400_000;
    const matches = !isDay || input.dateRange.gte === `${busyDay}T00:00:00.000Z`;
    const actualTotal = matches ? (isDay ? dayTotal : gridTotal) : 0;
    const total = Math.min(actualTotal, input.totalLimit ?? actualTotal);
    const from = (input.page - 1) * input.pageSize;
    return {
      records: Array.from(
        { length: Math.max(0, Math.min(input.pageSize, dayTotal - from, actualTotal - from)) },
        (_, i) => record(from + i + 1),
      ),
      total,
      totalCapped: actualTotal > total,
      page: input.page,
      totalPages: Math.ceil(total / input.pageSize),
    };
  });
  state.workspace = {
    scopeKey: "mobile:bounded-calendar",
    client: { records: { listPage } },
  } as unknown as NonNullable<typeof state.workspace>;
  return listPage;
};
const mount = async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client: client as QueryClient },
        createElement(BaseCalendarView, {
          base,
          activeView: view,
          fields: base.fields,
          onOpenRecord: () => undefined,
        }),
      ),
    ),
  );
};
const settle = async () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
const button = (name: string, target: ParentNode = container) =>
  [...target.querySelectorAll("button")].find(
    (element) => (element.getAttribute("aria-label") ?? element.textContent) === name,
  );
const click = (element: HTMLElement | undefined) => {
  expect(element).toBeTruthy();
  act(() => element?.click());
};
const callsOfSize = (spy: ReturnType<typeof makeClient>, size: number) =>
  spy.mock.calls.map(([input]) => input).filter((input) => input.pageSize === size);

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  client?.clear();
  root = undefined;
  client = undefined;
});

describe("bounded native calendar", () => {
  it("reads just four previews per day when the month exceeds 1,000 records", async () => {
    const listPage = makeClient(2006, 100_000);
    await mount();
    await vi.waitFor(async () => {
      await settle();
      expect(button(`1000+ records on ${busyDay}`)).toBeTruthy();
    });
    expect(callsOfSize(listPage, 100)).toHaveLength(1);
    expect(callsOfSize(listPage, 4)).toHaveLength(42);
    expect(listPage.mock.calls.every(([input]) => input.totalLimit === 1000)).toBe(true);
    expect(container.textContent).toContain("Task 4");
    expect(container.textContent).not.toContain("Task 5");
    // No automatic next-page draining, even after the preview has settled.
    await settle();
    expect(callsOfSize(listPage, 100)).toHaveLength(1);
  });

  it("opens only the selected day's paged list and fetches more only on demand", async () => {
    const listPage = makeClient(2006, 100_000);
    await mount();
    await vi.waitFor(async () => {
      await settle();
      expect(button(`1000+ records on ${busyDay}`)).toBeTruthy();
    });
    expect(callsOfSize(listPage, 50)).toHaveLength(0);
    click(button(`1000+ records on ${busyDay}`));
    await vi.waitFor(async () => {
      await settle();
      expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Task 50");
    });
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).not.toContain("Task 51");
    expect(callsOfSize(listPage, 50)[0]).toMatchObject({
      dateRange: { gte: `${busyDay}T00:00:00.000Z` },
      page: 1,
      totalLimit: 1000,
    });
    click(button("Load more", dialog));
    await vi.waitFor(async () => {
      await settle();
      expect(dialog.textContent).toContain("Task 100");
    });
    expect(callsOfSize(listPage, 50).map((input) => input.page)).toEqual([1, 2]);
    click(button("Close day", dialog));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("lets a reader page past the preview's 1,000 count without automatically draining the day", async () => {
    const listPage = makeClient(1006, 100_000);
    await mount();
    await vi.waitFor(async () => {
      await settle();
      expect(button(`1000+ records on ${busyDay}`)).toBeTruthy();
    });
    click(button(`1000+ records on ${busyDay}`));
    await vi.waitFor(async () => {
      await settle();
      expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Task 50");
    });
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    for (let page = 2; page <= 21; page++) {
      click(button("Load more", dialog));
      await vi.waitFor(async () => {
        await settle();
        expect(dialog.textContent).toContain(`Task ${Math.min(page * 50, 1006)}`);
      });
    }
    expect(button("Load more", dialog)).toBeUndefined();
    expect(callsOfSize(listPage, 50).at(-1)).toMatchObject({ page: 21, totalLimit: 1051 });
    expect(callsOfSize(listPage, 100)).toHaveLength(1);
  });

  it("keeps a small month's six records and opens overflow from the local slice", async () => {
    const listPage = makeClient(6);
    await mount();
    await vi.waitFor(async () => {
      await settle();
      expect(button(`6 records on ${busyDay}`)).toBeTruthy();
    });
    click(button(`6 records on ${busyDay}`));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Task 6");
    expect(callsOfSize(listPage, 4)).toHaveLength(0);
    expect(callsOfSize(listPage, 50)).toHaveLength(0);
  });

  it("shows a failed day preview without automatically repeating a timeout, and allows retry", async () => {
    const listPage = makeClient(2006);
    const read = listPage.getMockImplementation();
    let fail = true;
    const timeout = Object.assign(new Error("Add a filter to narrow this view."), {
      code: "TIMEOUT",
    });
    listPage.mockImplementation(async (input) => {
      if (input.pageSize === 4 && input.dateRange.gte === `${busyDay}T00:00:00.000Z` && fail)
        throw timeout;
      return (read as NonNullable<typeof read>)(input);
    });
    await mount();
    await vi.waitFor(async () => {
      await settle();
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(timeout.message);
    });
    expect(callsOfSize(listPage, 4)).toHaveLength(42);
    fail = false;
    click(button("Retry month"));
    await vi.waitFor(async () => {
      await settle();
      expect(button(`1000+ records on ${busyDay}`)).toBeTruthy();
    });
    expect(callsOfSize(listPage, 4)).toHaveLength(43);
  });
});
