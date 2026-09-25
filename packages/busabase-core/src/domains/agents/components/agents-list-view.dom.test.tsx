// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
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

type SlugMutation = (input: { slug: string }) => Promise<{ ok: true }>;

function stubOrpc(options: {
  listConnections?: (scope: AgentConnectionScope) => Promise<AgentConnectionVO[]>;
  disconnect?: ReturnType<typeof vi.fn<SlugMutation>>;
  deleteHistory?: ReturnType<typeof vi.fn<SlugMutation>>;
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
