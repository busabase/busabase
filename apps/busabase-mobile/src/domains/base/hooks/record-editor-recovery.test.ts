// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  type BusabaseORPCClient,
  createBusabaseQueryUtils,
} from "busabase-contract/api-client/react-query";
import type { BaseVO } from "busabase-contract/types";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import NewRecordScreen from "../../../../app/base/[slug]/new";
import EditRecordScreen from "../../../../app/records/[id]/edit";

const state = vi.hoisted(() => ({
  workspace: null as ReturnType<typeof useBusabaseOrpc>,
  form: null as {
    fields: BaseVO["fields"];
    values: Record<string, string>;
    onChange: (slug: string, value: string) => void;
  } | null,
  buttons: new Map<string, { onPress: () => void; disabled?: boolean }>(),
  errors: [] as string[],
  router: { replace: vi.fn(), back: vi.fn(), canGoBack: () => true },
}));

vi.mock("~/api/use-busabase-orpc", () => ({ useBusabaseOrpc: () => state.workspace }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "record-a", slug: "sales" }),
  useRouter: () => state.router,
  useFocusEffect: () => undefined,
}));
vi.mock("react-native", () => ({
  Pressable: ({ children }: { children?: ReactNode }) => children,
  Platform: {
    OS: "ios",
    select: (values: Record<string, unknown>) => values.ios ?? values.default,
  },
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("lucide-react-native", () => ({ ArrowLeft: () => null }));
vi.mock("~/components/native-screen", () => ({
  NativeActionBar: ({ children }: { children?: ReactNode }) => children,
  NativeSection: ({ children }: { children?: ReactNode }) => children,
  NativeBottomSheet: () => null,
  NativeEmptyState: () => null,
  NativeLoadingState: () => null,
  NativeInlineError: ({ message }: { message: string }) => {
    state.errors.push(message);
    return null;
  },
}));
vi.mock("~/components/ui/Button", () => ({
  Button: (props: { label: string; onPress: () => void; disabled?: boolean }) => {
    state.buttons.set(props.label, props);
    return null;
  },
}));
vi.mock("~/domains/base/components/RecordForm", () => ({
  RecordForm: (props: NonNullable<typeof state.form>) => {
    state.form = props;
    return null;
  },
}));
vi.mock("~/domains/workspace/components/ConnectionGuard", () => ({
  ConnectionGuard: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("~/domains/workspace/components/DrawerScaffold", () => ({
  DrawerScaffold: ({ children, footer }: { children?: ReactNode; footer?: ReactNode }) =>
    createElement("div", null, children, footer),
}));
vi.mock("~/theme/use-tokens", () => ({ useTokens: () => ({}) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
const roots: Root[] = [];
const clients: QueryClient[] = [];
const fields = [
  { id: "field-title", slug: "title", name: "Title", type: "text", options: {} },
  { id: "field-note", slug: "note", name: "Note", type: "text", options: {} },
] as BaseVO["fields"];
const base = { id: "base-a", slug: "sales", name: "Sales", fields } as BaseVO;
const record = (title: string, note: string) =>
  ({
    id: "record-a",
    baseId: base.id,
    base,
    headCommit: { payload: { title, note } },
  }) as unknown as Awaited<ReturnType<BusabaseORPCClient["records"]["get"]>>;

const setup = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(queryClient);
  const scopeKey = "mobile:workspace-a";
  const orpc = createBusabaseQueryUtils("http://server.test/api/rpc", { batch: false }, scopeKey);
  const update = vi.fn(async () => ({ id: "record-a", materialized: true }));
  const create = vi.fn(async () => ({ id: "cr-new", materialized: false }));
  state.workspace = {
    scopeKey,
    orpc,
    serverUrl: "http://server.test",
    spaceScope: "workspace-a",
    userId: null,
    client: { records: { changeRequest: update }, bases: { createChangeRequest: create } },
  } as unknown as NonNullable<ReturnType<typeof useBusabaseOrpc>>;
  const recordKey = orpc.records.get.queryOptions({ input: { recordId: "record-a" } }).queryKey;
  const baseKey = orpc.bases.list.queryOptions({ input: {} }).queryKey;
  queryClient.setQueryData(recordKey, record("Before", "Original note"));
  queryClient.setQueryData(baseKey, [base]);
  return { queryClient, scopeKey, orpc, recordKey, baseKey, update, create };
};

const render = (client: QueryClient, Screen: () => ReactNode) => {
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const rerender = () =>
    act(() => root.render(createElement(QueryClientProvider, { client }, createElement(Screen))));
  rerender();
  return { rerender };
};

const settle = async () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

beforeEach(() => {
  state.form = null;
  state.buttons.clear();
  state.errors = [];
  state.router.replace.mockReset();
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const client of clients.splice(0)) client.clear();
});

describe("record screen recovery wiring", () => {
  it("preserves typed edit values and saves only local changes after the record cache updates", async () => {
    const { queryClient, recordKey, update } = setup();
    render(queryClient, EditRecordScreen);
    act(() => state.form?.onChange("title", "My unsaved title"));
    await act(async () => {
      queryClient.setQueryData(recordKey, record("Remote title", "Remote note"));
    });
    await settle();

    expect(state.form?.values).toEqual({ title: "My unsaved title", note: "Remote note" });
    act(() => state.buttons.get("Save change request")?.onPress());
    await settle();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: "record-a", fields: { title: "My unsaved title" } }),
    );
    expect(state.router.replace).toHaveBeenCalledWith({
      pathname: "/records/[id]",
      params: { id: "record-a" },
    });
  });

  it("preserves a new record draft across Base metadata refresh and opens the pending proposal", async () => {
    const { queryClient, baseKey, create } = setup();
    render(queryClient, NewRecordScreen);
    act(() => state.form?.onChange("title", "My new record"));
    await act(async () => {
      queryClient.setQueryData(baseKey, [{ ...base, name: "Renamed Base" }]);
    });
    await settle();

    expect(state.form?.values.title).toBe("My new record");
    act(() => state.buttons.get("Create change request")?.onPress());
    await settle();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ baseId: "base-a", fields: { title: "My new record", note: "" } }),
    );
    expect(state.router.replace).toHaveBeenCalledWith({
      pathname: "/change-requests/[id]",
      params: { id: "cr-new" },
    });
  });

  it("keeps the draft and blocks saving if an edited field changes type remotely", async () => {
    const { queryClient, recordKey, update } = setup();
    render(queryClient, EditRecordScreen);
    act(() => state.form?.onChange("title", "Keep this text"));
    await act(async () => {
      queryClient.setQueryData(recordKey, {
        ...record("25", "Original note"),
        base: { ...base, fields: [{ ...fields[0], type: "number" }, fields[1]] },
      });
    });
    await settle();

    expect(state.form?.values.title).toBe("Keep this text");
    expect(state.form?.fields[0].type).toBe("text");
    expect(state.buttons.get("Save change request")?.disabled).toBe(true);
    expect(state.errors.some((message) => message.includes("Your draft is kept"))).toBe(true);
    act(() => state.buttons.get("Save change request")?.onPress());
    await settle();
    expect(update).not.toHaveBeenCalled();
  });

  it("does not navigate into the old workspace when an in-flight save finishes after switching", async () => {
    const { queryClient, update } = setup();
    let finish!: (outcome: { id: string; materialized: boolean }) => void;
    update.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = render(queryClient, EditRecordScreen);
    act(() => state.form?.onChange("title", "Saving in A"));
    act(() => state.buttons.get("Save change request")?.onPress());
    await settle();
    expect(update).toHaveBeenCalledTimes(1);
    const scopeB = "mobile:workspace-b";
    const orpcB = createBusabaseQueryUtils("http://server.test/api/rpc", { batch: false }, scopeB);
    if (!state.workspace) throw new Error("Expected a connected workspace");
    state.workspace = { ...state.workspace, scopeKey: scopeB, orpc: orpcB };
    queryClient.setQueryData(
      orpcB.records.get.queryOptions({ input: { recordId: "record-a" } }).queryKey,
      record("Workspace B", "B note"),
    );
    rerender();

    await act(async () => finish({ id: "record-a", materialized: true }));
    await settle();
    expect(state.router.replace).not.toHaveBeenCalled();
    expect(state.form?.values.title).toBe("Workspace B");
    expect(
      queryClient.getQueryState(
        orpcB.records.get.queryOptions({ input: { recordId: "record-a" } }).queryKey,
      )?.isInvalidated,
    ).toBe(false);
  });

  it("does not navigate after the saving editor has unmounted", async () => {
    const { queryClient, update } = setup();
    let finish!: (outcome: { id: string; materialized: boolean }) => void;
    update.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(queryClient, EditRecordScreen);
    act(() => state.form?.onChange("title", "Saving before departure"));
    act(() => state.buttons.get("Save change request")?.onPress());
    await settle();
    act(() => roots.pop()?.unmount());
    await act(async () => finish({ id: "record-a", materialized: true }));
    await settle();

    expect(update).toHaveBeenCalledTimes(1);
    expect(state.router.replace).not.toHaveBeenCalled();
  });
});
