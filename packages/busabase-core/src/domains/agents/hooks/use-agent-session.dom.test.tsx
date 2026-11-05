// @vitest-environment jsdom

import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentSessionEventVO, AgentSessionVO } from "busabase-contract/domains/agents/types";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentSession } from "./use-agent-session";

const transport = vi.hoisted(() => ({
  streams: [] as {
    onEvent: (event: AgentSessionEventVO) => void;
    onError: () => void;
    onFinish: () => void;
    unsubscribe: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock("@orpc/client", () => ({
  consumeEventIterator: vi.fn((_iterator, callbacks) => {
    const unsubscribe = vi.fn();
    transport.streams.push({
      ...callbacks,
      onError: () => {
        callbacks.onError?.();
        callbacks.onFinish?.({ isSuccess: false });
      },
      onFinish: () => callbacks.onFinish?.({ isSuccess: true }),
      unsubscribe,
    });
    return unsubscribe;
  }),
}));

const listKey = ["sessions", "list"];
const pagedKey = ["sessions", "paged", "agent"];
const at = "2026-10-08T00:00:00.000Z";
const model = {
  id: "model",
  name: "Model",
  currentValue: "fresh",
  options: [{ value: "fresh", name: "Fresh" }],
};
function session(id: string, modelOption: AgentSessionVO["modelOption"] = null): AgentSessionVO {
  return {
    id,
    slug: "agent",
    agentName: "Agent",
    transport: "local-subprocess",
    status: "connecting",
    createdAt: at,
    lastActivityAt: at,
    error: null,
    modelOption,
  };
}

function mount(
  initialModel: AgentSessionVO["modelOption"] = null,
  paged = true,
  supervised = false,
  subscribeResult?: (...args: unknown[]) => unknown,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  let authoritative = [session("a", model), session("b", model)];
  const list = vi.fn(async () => authoritative);
  const page = vi.fn(async () => ({ items: authoritative, nextCursor: null }));
  client.setQueryData(listKey, [session("a", initialModel), session("b", model)]);
  client.setQueryData(pagedKey, {
    pages: [{ items: [session("a", initialModel), session("b", model)], nextCursor: null }],
    pageParams: [null],
  });
  const subscribe = vi.fn();
  if (subscribeResult) subscribe.mockImplementation(subscribeResult);
  const orpc = {
    agents: {
      sessions: {
        list: { queryKey: () => listKey },
        subscribe: { call: subscribe },
        prompt: { call: vi.fn() },
        respondToPermission: { call: vi.fn() },
        cancel: { call: vi.fn() },
      },
    },
  } as unknown as BusabaseQueryUtils;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ id }: { id: string | null }) => {
      const flat = useQuery({ queryKey: listKey, queryFn: list });
      const pages = useInfiniteQuery({
        queryKey: pagedKey,
        queryFn: page,
        initialPageParam: null,
        getNextPageParam: () => undefined,
      });
      return {
        chat: useAgentSession(orpc, id, paged ? pagedKey : undefined, undefined, undefined, {
          supervised,
        }),
        flat: flat.data,
        pages: pages.data,
      };
    },
    { wrapper, initialProps: { id: "a" as string | null } },
  );
  return {
    ...hook,
    client,
    list,
    page,
    subscribe,
    setAuthoritative: (rows: AgentSessionVO[]) => {
      authoritative = rows;
    },
  };
}

function emit(
  status: AgentSessionVO["status"],
  seq = 1,
  stream = transport.streams.length - 1,
  sessionId = "a",
) {
  act(() =>
    transport.streams[stream].onEvent({
      sessionId,
      seq,
      kind: "status",
      status,
      at,
    }),
  );
}
async function connected(count = 1) {
  await waitFor(() => expect(transport.streams).toHaveLength(count));
}

describe("useAgentSession readiness metadata", () => {
  beforeEach(() => {
    transport.streams.length = 0;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each(["idle", "busy", "waiting_permission"] as const)(
    "refreshes both active lists on first %s without polling",
    async (status) => {
      const h = mount();
      await connected();
      expect(h.result.current.flat?.[0].modelOption).toBeNull();
      emit("connecting", 0);
      expect(h.list).not.toHaveBeenCalled();
      emit(status);
      await waitFor(() => expect(h.result.current.flat?.[0].modelOption).toEqual(model));
      await waitFor(() =>
        expect(h.result.current.pages?.pages[0].items[0].modelOption).toEqual(model),
      );
      expect(h.list).toHaveBeenCalledTimes(1);
      expect(h.page).toHaveBeenCalledTimes(1);
      for (const next of ["busy", "waiting_permission", "idle"] as const) emit(next, 2);
      act(() => {
        for (let seq = 3; seq < 23; seq++)
          transport.streams[0].onEvent({
            sessionId: "a",
            seq,
            kind: "acpUpdate",
            at,
            acpUpdate: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "token" },
            },
          });
      });
      expect(h.list).toHaveBeenCalledTimes(1);
      expect(h.page).toHaveBeenCalledTimes(1);
    },
  );

  it("uses latest authoritative null instead of retaining warm metadata", async () => {
    const h = mount(model);
    h.setAuthoritative([session("a", null), session("b", model)]);
    await connected();
    h.client.setQueryData<AgentSessionVO[]>(listKey, (rows) =>
      rows?.map((row) => ({ ...row, status: "idle" })),
    );
    emit("idle");
    await waitFor(() => expect(h.result.current.flat?.[0].modelOption).toBeNull());
    await waitFor(() => expect(h.result.current.pages?.pages[0].items[0].modelOption).toBeNull());
    expect(h.result.current.flat?.[1].modelOption).toEqual(model);
  });

  it("resumes a normally finished owner stream but stops retrying a terminal session", async () => {
    const h = mount();
    await connected();
    emit("idle", 7);
    vi.useFakeTimers();
    act(() => transport.streams[0].onFinish());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(h.subscribe.mock.calls[1][0]).toEqual({ sessionId: "a", afterSeq: 7 });
    emit("failed", 8);
    act(() => transport.streams[1].onFinish());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(transport.streams).toHaveLength(2);
  });

  it("refreshes on replay, retains its single refresh across reconnect, and resumes afterSeq", async () => {
    const h = mount();
    await connected();
    emit("busy", 42);
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();
    act(() => transport.streams[0].onError());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(transport.streams).toHaveLength(2);
    expect(h.subscribe.mock.calls[1][0]).toEqual({ sessionId: "a", afterSeq: 42 });
    emit("idle", 43);
    expect(h.list).toHaveBeenCalledTimes(1);
    expect(h.page).toHaveBeenCalledTimes(1);
  });

  it("still refreshes if the first readiness arrives only after reconnect", async () => {
    const h = mount();
    await connected();
    emit("connecting", 5);
    vi.useFakeTimers();
    act(() => transport.streams[0].onError());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    vi.useRealTimers();
    emit("waiting_permission", 6);
    await waitFor(() => expect(h.result.current.flat?.[0].modelOption).toEqual(model));
    expect(h.list).toHaveBeenCalledTimes(1);
    expect(h.page).toHaveBeenCalledTimes(1);
  });

  it("resets readiness for a new subscription and ignores the cleaned-up stream", async () => {
    const h = mount();
    await connected();
    emit("idle");
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(1));
    h.rerender({ id: "b" });
    await connected(2);
    expect(transport.streams[0].unsubscribe).toHaveBeenCalledOnce();
    emit("idle", 2, 0);
    expect(h.list).toHaveBeenCalledTimes(1);
    emit("busy", 1, 1, "b");
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(2));
    expect(h.page).toHaveBeenCalledTimes(2);
  });

  it("keeps config updates refreshing after readiness and supports no paged key", async () => {
    const h = mount(null, false);
    await connected();
    emit("failed");
    expect(h.list).not.toHaveBeenCalled();
    emit("idle", 2);
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(1));
    act(() =>
      transport.streams[0].onEvent({
        sessionId: "a",
        seq: 3,
        kind: "acpUpdate",
        at,
        acpUpdate: { sessionUpdate: "config_option_update" },
      }),
    );
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(2));
    expect(h.page).not.toHaveBeenCalled();
  });

  it("refreshes the session's confirmed legacy mode after current_mode_update without losing other session metadata", async () => {
    const h = mount();
    await connected();
    const modeOption = {
      id: "mode",
      name: "Mode",
      source: "legacy" as const,
      currentValue: "code",
      options: [{ value: "code", name: "Code" }],
    };
    h.setAuthoritative([{ ...session("a", model), modeOption }, session("b", model)]);
    act(() =>
      transport.streams[0].onEvent({
        sessionId: "a",
        seq: 3,
        kind: "acpUpdate",
        at,
        acpUpdate: { sessionUpdate: "current_mode_update", currentModeId: "code" },
      }),
    );
    await waitFor(() => expect(h.result.current.flat?.[0].modeOption).toEqual(modeOption));
    expect(h.result.current.flat?.[1].modeOption).toBeUndefined();
    expect(h.result.current.pages?.pages[0].items[0].modeOption).toEqual(modeOption);
  });
});

describe("useAgentSession supervised observation", () => {
  beforeEach(() => {
    transport.streams.length = 0;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("tracks committed command identity and coalesces durable-state refreshes", async () => {
    const h = mount(null, true, true);
    await connected();
    act(() => {
      for (let seq = 1; seq < 5; seq++)
        transport.streams[0].onEvent({
          sessionId: "a",
          seq,
          kind: "acpUpdate",
          at,
          commandId: "cmd_committed_fixture",
          acpUpdate: { sessionUpdate: "user_message", text: "A question" },
        });
    });
    expect(h.result.current.chat.committedCommandIds.has("cmd_committed_fixture")).toBe(true);
    expect(h.result.current.chat.subscriptionHealth).toEqual({
      sessionId: "a",
      state: "connected",
    });
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(1));
    expect(h.page).toHaveBeenCalledTimes(1);
  });

  it("marks transient observation failure without fabricating a durable terminal event", async () => {
    const h = mount(null, true, true);
    await connected();
    act(() => transport.streams[0].onError());
    expect(h.result.current.chat.subscriptionHealth).toEqual({
      sessionId: "a",
      state: "recovering",
      reason: "error",
    });
    expect(h.result.current.flat?.[0].status).toBe("connecting");
    expect(h.result.current.chat.committedCommandIds.size).toBe(0);
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(1));
  });

  it("recovers an acknowledged idle stream without requiring another committed event", async () => {
    const iterator = { next: vi.fn() };
    const h = mount(null, true, true, () => Promise.resolve(iterator));
    await connected();
    await waitFor(() => expect(h.result.current.chat.subscriptionHealth?.state).toBe("connected"));
    emit("idle", 7);
    vi.useFakeTimers();
    act(() => transport.streams[0].onError());
    expect(h.result.current.chat.subscriptionHealth?.state).toBe("recovering");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(transport.streams).toHaveLength(2);
    expect(h.subscribe.mock.calls[1][0]).toEqual({ sessionId: "a", afterSeq: 7 });
    expect(h.result.current.chat.subscriptionHealth).toEqual({
      sessionId: "a",
      state: "connected",
    });
    expect(h.result.current.chat.committedCommandIds.size).toBe(0);
    expect(h.result.current.flat?.[0].status).toBe("connecting");
    act(() => transport.streams[1].onFinish());
    expect(h.result.current.chat.subscriptionHealth?.state).toBe("recovering");
  });

  it("ignores an old subscription acknowledgement after another session has failed", async () => {
    let resolveOld!: (value: { next: ReturnType<typeof vi.fn> }) => void;
    const old = new Promise<{ next: ReturnType<typeof vi.fn> }>((resolve) => {
      resolveOld = resolve;
    });
    const h = mount(null, true, true, (input) =>
      (input as { sessionId: string }).sessionId === "a" ? old : Promise.resolve({ next: vi.fn() }),
    );
    await connected();
    h.rerender({ id: "b" });
    await connected(2);
    await waitFor(() => expect(h.result.current.chat.subscriptionHealth?.state).toBe("connected"));
    act(() => transport.streams[1].onError());
    await act(async () => {
      resolveOld({ next: vi.fn() });
      await old;
    });
    expect(h.result.current.chat.subscriptionHealth).toEqual({
      sessionId: "b",
      state: "recovering",
      reason: "error",
    });
  });

  it("does not acknowledge a malformed iterator or keep a closed stream connected", async () => {
    const h = mount(null, true, true, () => Promise.resolve({}));
    await connected();
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.result.current.chat.subscriptionHealth).toBeNull();
    act(() => transport.streams[0].onFinish());
    expect(h.result.current.chat.subscriptionHealth).toEqual({
      sessionId: "a",
      state: "recovering",
      reason: "closed",
    });
  });

  it("does not carry one session's ephemeral recovery state or committed command set to another", async () => {
    const h = mount(null, true, true);
    await connected();
    act(() => {
      transport.streams[0].onEvent({
        sessionId: "a",
        seq: 1,
        kind: "acpUpdate",
        at,
        commandId: "cmd_first_session",
        acpUpdate: { sessionUpdate: "user_message", text: "first" },
      });
      transport.streams[0].onError();
    });
    h.rerender({ id: "b" });
    await connected(2);
    expect(h.result.current.chat.subscriptionHealth).toBeNull();
    expect(h.result.current.chat.committedCommandIds.size).toBe(0);
    act(() =>
      transport.streams[0].onEvent({
        sessionId: "a",
        seq: 2,
        kind: "status",
        status: "failed",
        at,
      }),
    );
    expect(h.result.current.chat.subscriptionHealth).toBeNull();
  });
});
