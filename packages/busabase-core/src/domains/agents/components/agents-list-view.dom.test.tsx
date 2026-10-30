// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AgentConnectionDetailVO,
  AgentConnectionScope,
  AgentConnectionVO,
  AgentSessionVO,
} from "busabase-contract/domains/agents/types";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, type CoreLocale } from "../../../i18n";
import { AgentsListView } from "./agents-list-view";

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const SESSION: AgentSessionVO = {
  id: "sess-1",
  slug: "claude-acp",
  agentName: "Claude Code",
  transport: "local-subprocess",
  status: "failed",
  createdAt: "2026-09-15T00:00:00.000Z",
  lastActivityAt: "2026-09-15T00:00:00.000Z",
  error: "Connection closed",
  modelOption: null,
};

const CONNECTION: AgentConnectionVO = {
  slug: "claude-acp",
  agentName: "Claude Code",
  transport: "local-subprocess",
  sessionCount: 5,
  latest: SESSION,
  connected: true,
  ownedByCurrentUser: true,
};

const CODEX_CONNECTION: AgentConnectionVO = {
  ...CONNECTION,
  slug: "codex-acp",
  agentName: "Codex CLI",
  latest: { ...SESSION, id: "sess-2", slug: "codex-acp", agentName: "Codex CLI" },
};

const ROUTER_CONNECTION: AgentConnectionVO = {
  ...CONNECTION,
  slug: "acprouter:device-1",
  agentName: "Router laptop",
  transport: "remote-websocket",
  latest: { ...SESSION, slug: "acprouter:device-1", transport: "remote-websocket" },
};

const ROUTER_DETAIL: AgentConnectionDetailVO = {
  slug: ROUTER_CONNECTION.slug,
  agentName: ROUTER_CONNECTION.agentName,
  provider: "acprouter",
  providerAgentName: "claude-acp",
  agentId: "remote-agent-id",
  transport: "remote-websocket",
  status: "saved",
  ownedByCurrentUser: true,
  connectedBy: null,
  routerWorkspaceName: "Engineering",
  deviceId: "work-laptop",
};

type SlugMutation = (input: { slug: string }) => Promise<{ ok: true }>;

function stubOrpc(options: {
  listConnections?: (scope: AgentConnectionScope) => Promise<AgentConnectionVO[]>;
  disconnect?: ReturnType<typeof vi.fn<SlugMutation>>;
  deleteHistory?: ReturnType<typeof vi.fn<SlugMutation>>;
  detail?: () => Promise<AgentConnectionDetailVO>;
  rename?: (input: { slug: string; name: string }) => Promise<AgentConnectionDetailVO>;
}) {
  const listConnections =
    options.listConnections ?? vi.fn(async (_scope: AgentConnectionScope) => [CONNECTION]);
  const disconnect =
    options.disconnect ?? vi.fn(async (_input: { slug: string }) => ({ ok: true }));
  const deleteHistory =
    options.deleteHistory ?? vi.fn(async (_input: { slug: string }) => ({ ok: true }));

  return {
    orpc: {
      agents: {
        connections: {
          detail: {
            queryOptions: ({ input }: { input: { slug: string } }) => ({
              queryKey: ["agents", "detail", input.slug],
              queryFn: options.detail ?? (async () => ROUTER_DETAIL),
            }),
            queryKey: ({ input }: { input: { slug: string } }) => ["agents", "detail", input.slug],
          },
          rename: {
            mutationOptions: () => ({
              mutationFn:
                options.rename ??
                (async (input: { name: string }) => ({ ...ROUTER_DETAIL, agentName: input.name })),
            }),
          },
          list: {
            queryOptions: ({ input }: { input: { scope: AgentConnectionScope } }) => ({
              queryKey: ["agents", "connections", input.scope],
              queryFn: () => listConnections(input.scope),
            }),
            queryKey: ({ input }: { input: { scope: AgentConnectionScope } }) => [
              "agents",
              "connections",
              input.scope,
            ],
          },
        },
        disconnect: { mutationOptions: () => ({ mutationFn: disconnect }) },
        deleteHistory: { mutationOptions: () => ({ mutationFn: deleteHistory }) },
        sessions: { list: { queryKey: () => ["agents", "sessions", "list"] } },
        catalog: { queryKey: () => ["agents", "catalog"] },
      },
    } as unknown as BusabaseQueryUtils,
    deleteHistory,
    disconnect,
    listConnections,
  };
}

function renderView(options: {
  locale?: CoreLocale;
  listConnections?: (scope: AgentConnectionScope) => Promise<AgentConnectionVO[]>;
  disconnect?: ReturnType<typeof vi.fn<SlugMutation>>;
  deleteHistory?: ReturnType<typeof vi.fn<SlugMutation>>;
  detail?: () => Promise<AgentConnectionDetailVO>;
  rename?: (input: { slug: string; name: string }) => Promise<AgentConnectionDetailVO>;
  onAddAgent?: () => void;
  onSelectAgent?: (slug: string) => void;
}) {
  const stubs = stubOrpc(options);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onAddAgent = options.onAddAgent ?? vi.fn();
  const onSelectAgent = options.onSelectAgent ?? vi.fn();
  const content = (
    <QueryClientProvider client={client}>
      <AgentsListView onAddAgent={onAddAgent} onSelectAgent={onSelectAgent} orpc={stubs.orpc} />
    </QueryClientProvider>
  );
  const wrap = (children: ReactNode) =>
    options.locale ? (
      <CoreI18nProvider locale={options.locale}>{children}</CoreI18nProvider>
    ) : (
      children
    );
  render(wrap(content));
  return { ...stubs, onAddAgent, onSelectAgent };
}

const openAgentActions = async (name = "Actions for Claude Code") => {
  const trigger = await screen.findByRole("button", { name });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  return trigger;
};

describe("AgentsListView", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("opens safe connection details from More and renames the selected agent persistently", async () => {
    let currentName = ROUTER_CONNECTION.agentName;
    const rename = vi.fn(async ({ name }: { slug: string; name: string }) => {
      currentName = name;
      return { ...ROUTER_DETAIL, agentName: name };
    });
    const { onSelectAgent } = renderView({
      listConnections: async () => [{ ...ROUTER_CONNECTION, agentName: currentName }],
      rename,
    });
    await openAgentActions("Actions for Router laptop");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Connection" }));
    const dialog = await screen.findByRole("dialog", { name: "Connection details" });
    expect(await within(dialog).findByText("Engineering")).toBeTruthy();
    expect(within(dialog).getByText("Authorization saved")).toBeTruthy();
    expect(onSelectAgent).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
    const input = within(dialog).getByLabelText("Display name");
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: "  Work assistant  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));
    await waitFor(() =>
      expect(rename).toHaveBeenCalledWith(
        { slug: ROUTER_CONNECTION.slug, name: "Work assistant" },
        expect.anything(),
      ),
    );
    expect(await within(dialog).findByText("Work assistant")).toBeTruthy();
    expect(within(dialog).getByText("claude-acp")).toBeTruthy();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]);
    expect(await screen.findByRole("button", { name: "Actions for Work assistant" })).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Actions for Work assistant" }),
      ),
    );
  });

  it("shows the resolved connector's name in connection details", async () => {
    renderView({
      listConnections: async () => [ROUTER_CONNECTION],
      detail: async () => ({
        ...ROUTER_DETAIL,
        connectedBy: { id: "owner-1", name: "Jordan Lee", email: null, image: null, role: null },
      }),
    });
    await openAgentActions("Actions for Router laptop");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Connection" }));
    const dialog = await screen.findByRole("dialog", { name: "Connection details" });
    expect(await within(dialog).findByText("Jordan Lee")).toBeTruthy();
  });

  it("falls back to an honest unknown label when the connector cannot be resolved", async () => {
    renderView({
      listConnections: async () => [ROUTER_CONNECTION],
      detail: async () => ({ ...ROUTER_DETAIL, connectedBy: null }),
    });
    await openAgentActions("Actions for Router laptop");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Connection" }));
    const dialog = await screen.findByRole("dialog", { name: "Connection details" });
    // A connector the server could not resolve (e.g. a departed account) must
    // read as honestly unknown, never silently blank or the viewer's own name.
    expect(await within(dialog).findByText("Unknown user")).toBeTruthy();
  });

  it("exposes Rename directly, validates blank input, and leaves failures open for retry", async () => {
    const rename = vi.fn(async () => {
      throw new Error("Connection changed. Try again.");
    });
    renderView({ listConnections: async () => [ROUTER_CONNECTION], rename });
    await openAgentActions("Actions for Router laptop");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByLabelText("Display name");
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByRole("alert").textContent).toContain("Enter a name");
    expect((screen.getByRole("button", { name: "Save name" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("Connection changed. Try again.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows a shared connection's details without owner-only controls", async () => {
    renderView({
      listConnections: async () => [
        { ...ROUTER_CONNECTION, slug: "buda:shared", ownedByCurrentUser: false, sessionCount: 0 },
      ],
      detail: async () => ({
        ...ROUTER_DETAIL,
        provider: "buda",
        slug: "buda:shared",
        ownedByCurrentUser: false,
      }),
    });
    await openAgentActions("Actions for Router laptop");
    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Disconnect" })).toBeNull();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Connection" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Only the connection owner/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("keeps primary navigation before secondary actions and switches inventory scope", async () => {
    const listConnections = vi.fn(async (scope: AgentConnectionScope) =>
      scope === "mine" ? [CONNECTION] : [],
    );
    const { onSelectAgent } = renderView({ listConnections });
    const card = (await screen.findByText("Claude Code")).closest("button");
    const actions = screen.getByRole("button", { name: "Actions for Claude Code" });
    const buttons = screen.getAllByRole("button");

    expect(card).not.toBeNull();
    if (!card) throw new Error("Agent card button was not rendered");
    expect(buttons.indexOf(card)).toBeLessThan(buttons.indexOf(actions));
    card.focus();
    expect(document.activeElement).toBe(card);
    fireEvent.click(card);
    expect(onSelectAgent).toHaveBeenCalledWith("claude-acp");

    const spaceTab = screen.getByRole("tab", { name: "Space" });
    spaceTab.focus();
    fireEvent.keyDown(spaceTab, { key: "Enter" });
    expect(await screen.findByText("No shared agents in this space yet")).toBeTruthy();
    expect(listConnections).toHaveBeenCalledWith("space");
  });

  it("disables Add agent after both local agent types have been added", async () => {
    const { onAddAgent } = renderView({
      listConnections: async () => [CONNECTION, CODEX_CONNECTION],
    });

    const addAgent = await screen.findByRole("button", { name: "Add agent" });
    await waitFor(() => expect((addAgent as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(addAgent);
    expect(onAddAgent).not.toHaveBeenCalled();
  });

  it("keeps Add agent enabled while one local agent type is still missing", async () => {
    const { onAddAgent } = renderView({ listConnections: async () => [CONNECTION] });

    const addAgent = await screen.findByRole("button", { name: "Add agent" });
    expect((addAgent as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(addAgent);
    expect(onAddAgent).toHaveBeenCalledOnce();
  });

  it.each([
    {
      locale: "en" as const,
      actions: "Actions for Router laptop",
      disconnectLabel: "Disconnect",
      title: "Disconnect this device?",
      body: "End this device’s active sessions and remove its connection. Conversation history is kept, and other devices stay connected.",
    },
    {
      locale: "zh-CN" as const,
      actions: "Router laptop 的操作",
      disconnectLabel: "断开连接",
      title: "断开此设备？",
      body: "结束此设备的活动会话并移除其连接。对话历史会保留，其他设备仍保持连接。",
    },
  ])(
    "explains retained Router history in $locale and disconnects only the selected device",
    async ({ locale, actions, disconnectLabel, title, body }) => {
      const { disconnect, deleteHistory } = renderView({
        locale,
        listConnections: async () => [
          ROUTER_CONNECTION,
          { ...ROUTER_CONNECTION, slug: "acprouter:device-2", agentName: "Router desktop" },
        ],
      });

      await openAgentActions(actions);
      fireEvent.click(await screen.findByRole("menuitem", { name: disconnectLabel }));

      const dialog = await screen.findByRole("alertdialog", { name: title });
      expect(within(dialog).getByText(body)).toBeTruthy();
      expect(disconnect).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole("button", { name: disconnectLabel }));

      await waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
      expect(disconnect.mock.calls[0]?.[0]).toEqual({ slug: "acprouter:device-1" });
      expect(deleteHistory).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    },
  );

  it("retains the existing confirmation for a non-Router connection", async () => {
    const { disconnect, deleteHistory } = renderView({});

    await openAgentActions();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Disconnect" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Delete agent connection?" });
    expect(dialog.textContent).toContain(
      "Delete Claude Code and its 5 sessions? This removes the saved connection and conversation history. This cannot be undone.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(disconnect.mock.calls[0]?.[0]).toEqual({ slug: "claude-acp" }));
    expect(deleteHistory).not.toHaveBeenCalled();
  });

  it("uses a localized alert dialog and success feedback for history deletion", async () => {
    const { deleteHistory } = renderView({ locale: "zh-CN" });

    await openAgentActions("Claude Code 的操作");
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除对话历史" }));

    const dialog = await screen.findByRole("alertdialog", { name: "删除对话历史？" });
    expect(dialog.textContent).toContain("永久删除与 Claude Code 的 5 个会话");
    fireEvent.click(screen.getByRole("button", { name: "删除对话历史" }));

    await waitFor(() => expect(deleteHistory.mock.calls[0]?.[0]).toEqual({ slug: "claude-acp" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("对话历史已删除。"));
  });

  it("shows the history deletion reason and leaves the confirmation open for retry", async () => {
    const deleteHistory = vi.fn(async (_input: { slug: string }) => {
      throw new Error("Unexpected server failure");
    });
    renderView({ deleteHistory, locale: "zh-CN" });

    await openAgentActions("Claude Code 的操作");
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除对话历史" }));
    fireEvent.click(await screen.findByRole("button", { name: "删除对话历史" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Unexpected server failure"));
    expect(screen.getByRole("alertdialog", { name: "删除对话历史？" })).toBeTruthy();
  });
});

describe("AgentsListView — connection availability", () => {
  afterEach(cleanup);

  it("reuses compact connection cards without rendering session counts", async () => {
    renderView({
      listConnections: async () => [
        { ...ROUTER_CONNECTION, sessionCount: 17, latest: { ...SESSION, status: "ended" } },
        {
          ...ROUTER_CONNECTION,
          slug: "acprouter:removed",
          agentName: "Removed desktop",
          connected: false,
          sessionCount: 3,
        },
      ],
    });
    await screen.findByText("Removed desktop");
    expect(screen.getByTestId("agent-connection-list").getAttribute("role")).toBe("list");
    const cards = screen.getAllByTestId("agent-connection-card");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.textContent).not.toMatch(/\b\d+\s+sessions?\b/i);
      expect(within(card).getAllByTestId("agent-connection-indicator")).toHaveLength(1);
      expect(card.getAttribute("role")).toBe("listitem");
      expect((card.querySelector("button") as HTMLButtonElement).disabled).toBe(false);
    }
    const saved = within(cards[0]).getByTestId("agent-connection-indicator");
    const disconnected = within(cards[1]).getByTestId("agent-connection-indicator");
    expect(saved.dataset.state).toBe("saved");
    expect(saved.classList.contains("bg-merged-strong")).toBe(true);
    expect(disconnected.dataset.state).toBe("disconnected");
    expect(disconnected.classList.contains("border-rejected-strong")).toBe(true);
    expect(within(cards[1]).getByText("View history")).toBeTruthy();
  });

  it("shows a connecting ring with a reduced-motion fallback and a readable activity label", async () => {
    renderView({
      listConnections: async () => [
        { ...ROUTER_CONNECTION, latest: { ...SESSION, status: "connecting" } },
      ],
    });
    expect(await screen.findByText("Connecting…")).toBeTruthy();
    expect(screen.getByText("Connection saved")).toBeTruthy();
    const indicator = screen.getByTestId("agent-connection-indicator");
    expect(indicator.dataset.connecting).toBe("true");
    expect(indicator.classList.contains("animate-spin")).toBe(true);
    expect(indicator.classList.contains("motion-reduce:animate-none")).toBe(true);
    expect(indicator.getAttribute("aria-hidden")).toBe("true");
  });

  it("uses an amber ring for pairing and a neutral dot for a launchable local agent", async () => {
    renderView({
      listConnections: async () => [
        { ...ROUTER_CONNECTION, connected: false, connectionState: "activating" },
        { ...CONNECTION, connected: false, latest: { ...SESSION, status: "ended" } },
      ],
    });
    expect(await screen.findByText("Finish pairing")).toBeTruthy();
    const pairingCard = screen.getByText("Finish pairing").closest("button");
    const localCard = screen.getByText("Local agent").closest("button");
    if (!pairingCard || !localCard) throw new Error("Missing connection card");
    expect(
      within(pairingCard)
        .getByTestId("agent-connection-indicator")
        .classList.contains("border-review-strong"),
    ).toBe(true);
    expect(
      within(localCard)
        .getByTestId("agent-connection-indicator")
        .classList.contains("bg-muted-foreground"),
    ).toBe(true);
    expect((localCard as HTMLButtonElement).disabled).toBe(false);
    expect(localCard.textContent).not.toContain("ended");
  });

  it("identifies saved connections separately from an ended conversation", async () => {
    renderView({
      listConnections: async () => [
        { ...ROUTER_CONNECTION, latest: { ...SESSION, status: "ended" } },
      ],
    });
    const card = (await screen.findByText("Router laptop")).closest("button");
    if (!card) throw new Error("Missing agent card");
    expect(within(card).getByText("Connection saved")).toBeTruthy();
    expect(within(card).queryByText("Open chat")).toBeNull();
    expect(within(card).queryByText("ended")).toBeNull();
    expect(card.textContent).not.toContain("Online");
  });

  it("keeps disconnected history readable even when its last recorded session was idle", async () => {
    const { onSelectAgent } = renderView({
      listConnections: async () => [
        { ...ROUTER_CONNECTION, connected: false, latest: { ...SESSION, status: "idle" } },
      ],
    });
    const card = (await screen.findByText("Router laptop")).closest("button");
    if (!card) throw new Error("Missing agent card");
    expect(within(card).getByText("Disconnected")).toBeTruthy();
    expect(within(card).getByText("View history")).toBeTruthy();
    expect(within(card).queryByText("idle")).toBeNull();
    fireEvent.click(card);
    expect(onSelectAgent).toHaveBeenCalledWith(ROUTER_CONNECTION.slug);
  });

  it("labels current session activity without replacing the connection state", async () => {
    renderView({
      listConnections: async () => [
        { ...ROUTER_CONNECTION, latest: { ...SESSION, status: "waiting_permission" } },
      ],
    });
    expect(await screen.findByText("Connection saved")).toBeTruthy();
    expect(screen.getByText("Needs input")).toBeTruthy();
  });

  it("offers connection details rather than empty history for an unfinished setup", async () => {
    const { onSelectAgent } = renderView({
      listConnections: async () => [
        {
          ...ROUTER_CONNECTION,
          connected: false,
          sessionCount: 0,
          latest: null,
          connectionState: "activating",
        },
      ],
    });
    const action = await screen.findByText("Finish pairing");
    expect(screen.queryByText("View history")).toBeNull();
    const card = action.closest("button");
    if (!card) throw new Error("Missing connection card");
    fireEvent.click(card);
    expect(onSelectAgent).toHaveBeenCalledWith(ROUTER_CONNECTION.slug);
  });

  it("gives unfinished pairing a distinct localized connection state", async () => {
    renderView({
      locale: "zh-CN",
      listConnections: async () => [
        { ...ROUTER_CONNECTION, connected: false, connectionState: "activating" },
      ],
    });
    expect(await screen.findByText("等待完成配对")).toBeTruthy();
    expect(screen.queryByText("查看连接")).toBeNull();
  });
});
