// @vitest-environment jsdom

import type { AcpBlock } from "@acp-ui/core/reduce";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentSessionVO } from "busabase-contract/domains/agents/types";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { SubmitPermissionProvider } from "../../dashboard/components/split-submit-button";
import type { LoadedNode } from "../../dashboard/node-detail-registry";

/**
 * "End this agent conversation" — the one affordance that releases a spawned
 * agent process without deleting the transcript.
 *
 * The ACP transport is stubbed out (`useAgentSession`): what is under test is
 * who is offered the control, which session it names, and how the server's
 * "there is no live process behind this id" reply reads to the user — none of
 * which involve a real agent.
 */

/**
 * jsdom ships neither `ResizeObserver` (the transcript's auto-scroll observes
 * its viewport) nor the Pointer Capture API (Radix menus call it while
 * opening). Both are browser plumbing this test has no opinion about.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const agentSession = vi.hoisted(() => ({
  blocks: [] as AcpBlock[],
  title: null,
  usage: null,
  sending: false,
  answerPermission: () => {},
  cancel: vi.fn(),
}));
vi.mock("../hooks/use-agent-session", () => ({
  useAgentSession: () => agentSession,
}));

vi.mock("@acp-ui/web/composer", () => ({
  AcpComposer: ({
    disabled,
    headerControls,
    labels,
    onSend,
    onStop,
    sending,
  }: {
    disabled?: boolean;
    headerControls?: ReactNode;
    labels?: { stopPrompt?: string };
    onSend: (text: string) => void;
    onStop?: () => void;
    sending?: boolean;
  }) => {
    const canStop = sending && onStop;
    return (
      <div>
        <div data-testid="composer-header">{headerControls}</div>
        <button
          aria-label={canStop ? (labels?.stopPrompt ?? "Stop") : undefined}
          disabled={canStop ? false : disabled}
          onClick={canStop ? onStop : () => onSend("Next question")}
          type="button"
        >
          {canStop ? "Stop" : "Send test prompt"}
        </button>
      </div>
    );
  },
}));

vi.mock("@acp-ui/web/transcript", () => ({
  AcpConversation: ({ activity }: { activity?: ReactNode }) => (
    <div data-testid="conversation">{activity}</div>
  ),
}));

const { AgentDetailView } = await import("./agent-detail-view");

const SESSION: AgentSessionVO = {
  id: "sess-1",
  slug: "test-agent",
  agentName: "Test Agent",
  transport: "local-subprocess",
  status: "idle",
  createdAt: "2026-09-13T00:00:00.000Z",
  lastActivityAt: "2026-09-13T00:00:00.000Z",
  error: null,
  modelOption: null,
};

const stubOrpc = (
  getItems: () => AgentSessionVO[],
  close: ReturnType<typeof vi.fn>,
  create: ReturnType<typeof vi.fn>,
  prompt: ReturnType<typeof vi.fn>,
  listPage?: () => Promise<{ items: AgentSessionVO[]; nextCursor: null }>,
) =>
  ({
    agents: {
      connections: {
        list: {
          queryOptions: () => ({ queryKey: ["agents", "connections"], queryFn: async () => [] }),
        },
      },
      sessions: {
        listPaged: {
          infiniteOptions: () => ({
            queryKey: ["agents", "sessions", "listPaged"],
            queryFn: listPage ?? (async () => ({ items: getItems(), nextCursor: null })),
            initialPageParam: undefined,
            getNextPageParam: () => undefined,
          }),
        },
        list: { queryKey: () => ["agents", "sessions", "list"] },
        create: { mutationOptions: () => ({ mutationFn: create }) },
        prompt: { call: prompt },
        setConfigOption: {
          mutationOptions: () => ({ mutationFn: async () => getItems()[0] }),
        },
        close: { mutationOptions: () => ({ mutationFn: close }) },
      },
    },
  }) as unknown as BusabaseQueryUtils;

function renderView(options: {
  sessions?: AgentSessionVO[] | (() => AgentSessionVO[]);
  close?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
  prompt?: ReturnType<typeof vi.fn>;
  listPage?: () => Promise<{ items: AgentSessionVO[]; nextCursor: null }>;
  permissionLevel?: ApiKeyPermissionLevel;
  compactSessionNavigation?: boolean;
  contextNode?: LoadedNode | null;
  locale?: string;
}) {
  const close = options.close ?? vi.fn(async () => ({ ok: true }));
  const sessions = options.sessions;
  const getItems = typeof sessions === "function" ? sessions : () => sessions ?? [SESSION];
  const create =
    options.create ?? vi.fn(async (_input: { slug: string }) => getItems()[0] as AgentSessionVO);
  const prompt = options.prompt ?? vi.fn(async () => ({ accepted: true }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrap = (children: ReactNode) =>
    options.permissionLevel ? (
      <SubmitPermissionProvider permissionLevel={options.permissionLevel}>
        {children}
      </SubmitPermissionProvider>
    ) : (
      children
    );
  const view = () => (
    <QueryClientProvider client={client}>
      <CoreI18nProvider locale={options.locale}>
        {wrap(
          <AgentDetailView
            agentSlug="test-agent"
            compactSessionNavigation={options.compactSessionNavigation}
            contextNode={options.contextNode}
            onBack={() => {}}
            orpc={stubOrpc(getItems, close, create, prompt, options.listPage)}
          />,
        )}
      </CoreI18nProvider>
    </QueryClientProvider>
  );
  const result = render(view());
  return { client, close, create, prompt, rerender: () => result.rerender(view()) };
}

/** Radix opens its menu on pointerdown, which jsdom does not synthesize from a click. */
const openSessionActions = async () => {
  const trigger = await screen.findByRole("button", { name: "Session actions" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  return screen.findByRole("menuitem", { name: /End session/ });
};

describe("AgentDetailView — end session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentSession.blocks = [];
    agentSession.sending = false;
    agentSession.cancel = vi.fn();
  });
  afterEach(cleanup);

  it("ends the session the user is looking at, and says the transcript survives", async () => {
    const { close } = renderView({});

    fireEvent.click(await openSessionActions());

    // The promise the dialog has to make before anyone will press the button.
    expect(await screen.findByText(/End this conversation\?/)).toBeTruthy();
    // Names the agent, and promises the transcript survives — the two things
    // that decide whether anyone is willing to press the button.
    expect(screen.getByText(/Stop Test Agent .* stays here to read/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "End session" }));

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(close.mock.calls[0]?.[0]).toEqual({ sessionId: "sess-1" });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("warns that ending interrupts a reply in flight", async () => {
    renderView({ sessions: [{ ...SESSION, status: "busy" }] });

    fireEvent.click(await openSessionActions());

    expect(await screen.findByText(/replying right now/)).toBeTruthy();
  });

  it("renders active status in the conversation instead of the header", async () => {
    renderView({ sessions: [{ ...SESSION, status: "busy" }] });

    const conversation = await screen.findByTestId("conversation");
    const indicator = screen.getByTestId("agent-activity-indicator");
    expect(conversation.contains(indicator)).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("replying…");
    expect(
      screen.getByTestId("agent-detail-view").querySelector("header [role='status']"),
    ).toBeNull();
  });

  it("keeps idle status out of the conversation", async () => {
    renderView({});

    await screen.findByTestId("conversation");
    expect(screen.queryByTestId("agent-activity-indicator")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows starting status as soon as an idle session begins sending", async () => {
    agentSession.sending = true;
    renderView({});

    await screen.findByTestId("conversation");
    expect(screen.getByRole("status").textContent).toContain("starting…");
  });

  it("keeps concurrent pending turns scoped to their own sessions", async () => {
    const sessionA = { ...SESSION, id: "sess-a" };
    const sessionB = {
      ...SESSION,
      id: "sess-b",
      createdAt: "2026-09-12T00:00:00.000Z",
      lastActivityAt: "2026-09-12T00:00:00.000Z",
    };
    const releases = new Map<string, (value: { accepted: true }) => void>();
    const prompt = vi.fn(
      ({ sessionId }: { sessionId: string }) =>
        new Promise<{ accepted: true }>((resolve) => releases.set(sessionId, resolve)),
    );
    renderView({ sessions: [sessionA, sessionB], prompt });

    fireEvent.click(await screen.findByRole("button", { name: "Send test prompt" }));
    expect(await screen.findByRole("button", { name: "Stop response" })).toBeTruthy();

    let rows = await screen.findAllByTestId("agent-session-item");
    fireEvent.click(rows[1] as HTMLElement);
    const sessionBSend = await screen.findByRole("button", { name: "Send test prompt" });
    expect((sessionBSend as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(sessionBSend);
    expect(prompt.mock.calls.map(([input]) => input.sessionId)).toEqual(["sess-a", "sess-b"]);
    expect(await screen.findByRole("button", { name: "Stop response" })).toBeTruthy();

    releases.get("sess-a")?.({ accepted: true });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop response" })).toBeTruthy();
    });

    rows = await screen.findAllByTestId("agent-session-item");
    fireEvent.click(rows[0] as HTMLElement);
    const sessionASend = await screen.findByRole("button", { name: "Send test prompt" });
    expect((sessionASend as HTMLButtonElement).disabled).toBe(false);

    rows = await screen.findAllByTestId("agent-session-item");
    fireEvent.click(rows[1] as HTMLElement);
    expect(await screen.findByRole("button", { name: "Stop response" })).toBeTruthy();

    releases.get("sess-b")?.({ accepted: true });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send test prompt" })).toBeTruthy();
    });
  });

  it("shows a prompt failure only in the session that produced it", async () => {
    const sessionA = { ...SESSION, id: "sess-a" };
    const sessionB = {
      ...SESSION,
      id: "sess-b",
      createdAt: "2026-09-12T00:00:00.000Z",
      lastActivityAt: "2026-09-12T00:00:00.000Z",
    };
    let rejectSessionA: ((error: Error) => void) | undefined;
    const prompt = vi.fn(
      () =>
        new Promise<{ accepted: true }>((_resolve, reject) => {
          rejectSessionA = reject;
        }),
    );
    renderView({ sessions: [sessionA, sessionB], prompt });

    fireEvent.click(await screen.findByRole("button", { name: "Send test prompt" }));
    let rows = await screen.findAllByTestId("agent-session-item");
    fireEvent.click(rows[1] as HTMLElement);
    rejectSessionA?.(new Error("Session A lost its connection"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send test prompt" })).toBeTruthy();
    });
    expect(screen.queryByRole("alert")).toBeNull();

    rows = await screen.findAllByTestId("agent-session-item");
    fireEvent.click(rows[0] as HTMLElement);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Session A lost its connection",
    );
  });

  it("shows the real archived-agent reason returned by the prompt API", async () => {
    const message = "This agent is archived. Restore it from Space Settings to use it again.";
    const prompt = vi.fn(async () => ({
      accepted: false as const,
      sessionId: SESSION.id,
      status: "failed" as const,
      promptRecorded: false,
      message,
    }));
    renderView({ locale: "zh-CN", prompt });

    fireEvent.click(await screen.findByRole("button", { name: "Send test prompt" }));

    expect((await screen.findByRole("alert")).textContent).toContain(message);
    expect(screen.queryByText("无法继续此会话。")).toBeNull();
  });

  it("retracts an ambiguous send error when subscribed status proves the turn was accepted", async () => {
    const prompt = vi.fn(async () => {
      throw new Error("Gateway Timeout");
    });
    const { client } = renderView({ prompt });

    fireEvent.click(await screen.findByRole("button", { name: "Send test prompt" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Gateway Timeout");

    client.setQueryData(["agents", "sessions", "listPaged"], {
      pages: [{ items: [{ ...SESSION, status: "busy" }], nextCursor: null }],
      pageParams: [undefined],
    });

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("status").textContent).toContain("replying…");
  });

  it("offers Stop in the compact side panel while the first prompt is still connecting", async () => {
    agentSession.sending = true;
    renderView({
      compactSessionNavigation: true,
      sessions: [{ ...SESSION, status: "connecting" }],
    });

    const stop = await screen.findByRole("button", { name: "Stop response" });
    expect((stop as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(stop);
    expect(agentSession.cancel).toHaveBeenCalledTimes(1);
  });

  it("offers Stop for a restored busy session without local sending state", async () => {
    renderView({ sessions: [{ ...SESSION, status: "busy" }] });

    const stop = await screen.findByRole("button", { name: "Stop response" });
    fireEvent.click(stop);
    expect(agentSession.cancel).toHaveBeenCalledTimes(1);
  });

  it("shows connecting status in the conversation", async () => {
    renderView({ sessions: [{ ...SESSION, status: "connecting" }] });

    await screen.findByTestId("conversation");
    expect(screen.getByRole("status").textContent).toContain("connecting…");
  });

  it("removes the activity indicator when assistant content starts", async () => {
    agentSession.blocks = [
      { kind: "message", id: "user", role: "user", variant: "message", text: "Hi" },
      { kind: "message", id: "agent", role: "agent", variant: "message", text: "Hello" },
    ];
    renderView({ sessions: [{ ...SESSION, status: "busy" }] });

    await screen.findByTestId("conversation");
    expect(screen.queryByTestId("agent-activity-indicator")).toBeNull();
  });

  it.each([
    [
      "thought",
      { kind: "message", id: "thought", role: "agent", variant: "thought", text: "Thinking" },
    ],
    [
      "tool call",
      {
        kind: "tool_call",
        id: "tool",
        title: "Search",
        toolKind: null,
        status: "in_progress",
      },
    ],
    [
      "permission request",
      {
        kind: "permission",
        id: "permission",
        title: "Allow edit?",
        options: [],
        resolution: "pending",
      },
    ],
    ["session note", { kind: "note", id: "note", text: "Working" }],
  ] satisfies [string, AcpBlock][])(
    "treats the first %s block as real progress",
    async (_, block) => {
      agentSession.blocks = [
        { kind: "message", id: "user", role: "user", variant: "message", text: "Hi" },
        block,
      ];
      renderView({ sessions: [{ ...SESSION, status: "busy" }] });

      await screen.findByTestId("conversation");
      expect(screen.queryByTestId("agent-activity-indicator")).toBeNull();
    },
  );

  it("ignores earlier-turn progress through transcript reset and history reload", async () => {
    agentSession.blocks = [
      { kind: "message", id: "user-1", role: "user", variant: "message", text: "First" },
      { kind: "message", id: "agent-1", role: "agent", variant: "message", text: "Done" },
    ];
    const { rerender } = renderView({ prompt: vi.fn(() => new Promise(() => {})) });

    fireEvent.click(await screen.findByRole("button", { name: "Send test prompt" }));
    expect((await screen.findByRole("status")).textContent).toContain("starting…");

    agentSession.blocks = [];
    rerender();
    expect(screen.getByRole("status").textContent).toContain("starting…");

    agentSession.blocks = [
      { kind: "message", id: "user-1", role: "user", variant: "message", text: "First" },
      { kind: "message", id: "agent-1", role: "agent", variant: "message", text: "Done" },
    ];
    rerender();
    expect(screen.getByRole("status").textContent).toContain("starting…");

    agentSession.blocks = [
      ...agentSession.blocks,
      {
        kind: "message",
        id: "user-2",
        role: "user",
        variant: "message",
        text: "Next question",
      },
    ];
    rerender();
    expect(screen.getByRole("status").textContent).toContain("starting…");

    agentSession.blocks = [
      ...agentSession.blocks,
      { kind: "tool_call", id: "tool-2", title: "Search", toolKind: null, status: "in_progress" },
    ];
    rerender();
    expect(screen.queryByTestId("agent-activity-indicator")).toBeNull();
  });

  it("keeps current-turn tracking when an ended session continues in a new session", async () => {
    const ended = { ...SESSION, status: "ended" as const };
    const continued = { ...SESSION, id: "sess-2", status: "idle" as const };
    let sessions: AgentSessionVO[] = [ended];
    const create = vi.fn(async (_input: { slug: string }) => {
      sessions = [continued, ended];
      return continued;
    });
    const { rerender } = renderView({
      sessions: () => sessions,
      create,
      prompt: vi.fn(() => new Promise(() => {})),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Send test prompt" }));
    await waitFor(() => expect(create.mock.calls[0]?.[0]).toEqual({ slug: "test-agent" }));
    expect((await screen.findByRole("status")).textContent).toContain("starting…");

    agentSession.blocks = [
      {
        kind: "message",
        id: "continued-user",
        role: "user",
        variant: "message",
        text: "Next question",
      },
      {
        kind: "message",
        id: "continued-agent",
        role: "agent",
        variant: "thought",
        text: "Starting",
      },
    ];
    rerender();

    expect(screen.queryByTestId("agent-activity-indicator")).toBeNull();
  });

  it("keeps a terminal session locked until its continuation is selectable", async () => {
    const ended = { ...SESSION, status: "ended" as const };
    const continued = { ...SESSION, id: "sess-2", status: "idle" as const };
    let created = false;
    let releaseSessionList: (() => void) | undefined;
    const sessionListGate = new Promise<void>((resolve) => {
      releaseSessionList = resolve;
    });
    let releasePrompt: ((value: { accepted: true }) => void) | undefined;
    const prompt = vi.fn(
      () =>
        new Promise<{ accepted: true }>((resolve) => {
          releasePrompt = resolve;
        }),
    );
    const create = vi.fn(async () => {
      created = true;
      return continued;
    });
    renderView({
      sessions: [ended],
      create,
      prompt,
      listPage: async () => {
        if (!created) return { items: [ended], nextCursor: null };
        await sessionListGate;
        return { items: [continued, ended], nextCursor: null };
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Send test prompt" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    // The selected id already names the new session, but query data still
    // contains only the old terminal row. The fallback row must stay locked
    // until the refetch makes the continuation selectable.
    expect(await screen.findByRole("button", { name: "Stop response" })).toBeTruthy();
    expect(prompt).not.toHaveBeenCalled();

    releaseSessionList?.();
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "Stop response" })).toBeTruthy();

    releasePrompt?.({ accepted: true });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send test prompt" })).toBeTruthy();
    });
  });

  it("reads a session that was already gone as an outcome, not a failure", async () => {
    const close = vi.fn(async () => {
      throw new Error("Unknown agent session: sess-1");
    });
    renderView({ close });

    fireEvent.click(await openSessionActions());
    fireEvent.click(screen.getByRole("button", { name: "End session" }));

    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
    // The question is retracted either way — it has been answered.
    await waitFor(() => expect(screen.queryByText(/End this conversation\?/)).toBeNull());
  });

  it("surfaces a real failure with the server's own wording", async () => {
    const close = vi.fn(async () => {
      throw new Error("Agent is shutting down.");
    });
    renderView({ close });

    fireEvent.click(await openSessionActions());
    fireEvent.click(screen.getByRole("button", { name: "End session" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.any(String), {
        description: "Agent is shutting down.",
      }),
    );
  });

  it("offers nothing to end on a session that has already ended", async () => {
    renderView({ sessions: [{ ...SESSION, status: "ended" }] });

    await screen.findByTestId("agent-detail-view");
    expect(screen.queryByRole("button", { name: "Session actions" })).toBeNull();
  });

  it("hides the control from a member below write", async () => {
    renderView({ permissionLevel: "changeRequest" });

    await screen.findByTestId("agent-detail-view");
    expect(screen.queryByRole("button", { name: "Session actions" })).toBeNull();
  });

  it("keeps side-panel session navigation in the header menu at every width", async () => {
    renderView({ compactSessionNavigation: true });

    await screen.findByTestId("agent-detail-view");
    expect(screen.queryByRole("navigation", { name: "Sessions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Agent menu" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Session actions" })).toBeNull();
  });
});

describe("AgentDetailView — node context chip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentSession.blocks = [];
    agentSession.sending = false;
  });
  afterEach(cleanup);

  const node: LoadedNode = { id: "nod_visits", type: "base", name: "Visits", slug: "visits" };

  it("lands the chip inside the composer's header slot, not as a sibling before it", async () => {
    renderView({ contextNode: node });

    await screen.findByTestId("agent-detail-view");
    const header = screen.getByTestId("composer-header");
    expect(header.textContent).toContain("Visits");
    expect(header.textContent).not.toContain("Context");
    expect(screen.getByRole("button", { name: "Don't send this as context" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send test prompt" })).toBeTruthy();
  });

  it("renders no chip when there is no context node", async () => {
    renderView({});

    await screen.findByTestId("agent-detail-view");
    expect(screen.getByTestId("composer-header").textContent).toBe("");
  });

  it("removing the chip clears it from the header slot without affecting the rest of the composer", async () => {
    renderView({ contextNode: node });

    await screen.findByTestId("agent-detail-view");
    const header = screen.getByTestId("composer-header");
    expect(header.textContent).toContain("Visits");

    fireEvent.click(screen.getByRole("button", { name: "Don't send this as context" }));

    expect(header.textContent).toBe("");
    expect(
      (screen.getByRole("button", { name: "Send test prompt" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
