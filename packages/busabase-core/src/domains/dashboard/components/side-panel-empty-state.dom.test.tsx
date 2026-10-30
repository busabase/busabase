// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AgentConnectionDetailVO,
  AgentConnectionVO,
} from "busabase-contract/domains/agents/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { createKnownNodeCache } from "../helpers/known-node-cache";

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const openAgentChatTab = vi.fn();

vi.mock("./side-panel-sources", async () => {
  const actual =
    await vi.importActual<typeof import("./side-panel-sources")>("./side-panel-sources");
  return { ...actual, openAgentChatTab };
});

const { SidePanelAgentPicker, SidePanelEmptyState } = await import("./side-panel-empty-state");

const connection = (
  slug: string,
  agentName: string,
  latestSessionId?: string,
): AgentConnectionVO => ({
  slug,
  agentName,
  transport: "remote-websocket",
  sessionCount: latestSessionId ? 1 : 0,
  latest: latestSessionId
    ? {
        id: latestSessionId,
        slug,
        agentName,
        transport: "remote-websocket",
        status: "idle",
        createdAt: "2026-09-14T00:00:00.000Z",
        lastActivityAt: "2026-09-14T00:00:00.000Z",
        error: null,
        modelOption: null,
      }
    : null,
  connected: true,
  ownedByCurrentUser: true,
});

const DETAIL: AgentConnectionDetailVO = {
  slug: "buda:research",
  agentName: "Research",
  provider: "buda",
  providerAgentName: "Research",
  agentId: "remote-agent-id",
  transport: "remote-websocket",
  status: "saved",
  ownedByCurrentUser: true,
  connectedBy: null,
};

type SlugMutation = (input: { slug: string }) => Promise<{ ok: true }>;

const stubOrpc = (
  queryFn: () => Promise<AgentConnectionVO[]>,
  options: {
    disconnect?: ReturnType<typeof vi.fn<SlugMutation>>;
    deleteHistory?: ReturnType<typeof vi.fn<SlugMutation>>;
    detail?: () => Promise<AgentConnectionDetailVO>;
  } = {},
) =>
  ({
    agents: {
      connections: {
        list: {
          queryOptions: () => ({ queryKey: ["agents", "connections"], queryFn }),
          queryKey: () => ["agents", "connections"],
        },
        detail: {
          queryOptions: ({ input }: { input: { slug: string } }) => ({
            queryKey: ["agents", "detail", input.slug],
            queryFn: options.detail ?? (async () => DETAIL),
          }),
          queryKey: ({ input }: { input: { slug: string } }) => ["agents", "detail", input.slug],
        },
        rename: {
          mutationOptions: () => ({
            mutationFn: async (input: { name: string }) => ({ ...DETAIL, agentName: input.name }),
          }),
        },
      },
      disconnect: {
        mutationOptions: () => ({
          mutationFn: options.disconnect ?? vi.fn(async () => ({ ok: true })),
        }),
      },
      deleteHistory: {
        mutationOptions: () => ({
          mutationFn: options.deleteHistory ?? vi.fn(async () => ({ ok: true })),
        }),
      },
      sessions: { list: { queryKey: () => ["agents", "sessions", "list"] } },
      catalog: { queryKey: () => ["agents", "catalog"] },
    },
  }) as unknown as BusabaseQueryUtils;

let scopeCounter = 0;

function renderPicker({
  agents = [],
  orpc = stubOrpc(async () => agents),
  onBack = vi.fn(),
  onNavigate = vi.fn(),
}: {
  agents?: AgentConnectionVO[];
  orpc?: BusabaseQueryUtils;
  onBack?: () => void;
  onNavigate?: (path: string) => void;
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = (children: ReactNode) => (
    <CoreI18nProvider locale="en">
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </CoreI18nProvider>
  );

  const utils = render(
    wrapper(<SidePanelAgentPicker onBack={onBack} onNavigate={onNavigate} orpc={orpc} />),
  );
  return { ...utils, onBack, onNavigate };
}

function renderEmptyState({ onOpenAgents = vi.fn() }: { onOpenAgents?: () => void } = {}) {
  scopeCounter += 1;
  return render(
    <CoreI18nProvider locale="en">
      <SidePanelEmptyState
        currentNode={null}
        nodeCache={createKnownNodeCache(`test:empty-state:${scopeCounter}`)}
        onOpenAgents={onOpenAgents}
        onOpenSearch={vi.fn()}
      />
    </CoreI18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  openAgentChatTab.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("SidePanelEmptyState — Agents launcher card", () => {
  it("shows a forward chevron, marking it as a category with a next step", () => {
    renderEmptyState();

    const card = screen.getByRole("button", { name: /Agents/ });
    // The other two launcher cards (Pin, Search) act immediately and carry no
    // such affordance — only Agents drills into a second selection step.
    expect(card.querySelector(".lucide-chevron-right")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Search/ }).querySelector(".lucide-chevron-right"),
    ).toBe(null);
  });

  it("invokes onOpenAgents instead of navigating away", () => {
    const onOpenAgents = vi.fn();
    renderEmptyState({ onOpenAgents });

    fireEvent.click(screen.getByRole("button", { name: /Agents/ }));

    expect(onOpenAgents).toHaveBeenCalledTimes(1);
  });
});

describe("SidePanelAgentPicker", () => {
  it("keeps one connect action beside the picker heading when agents already exist", async () => {
    const { onNavigate } = renderPicker({
      agents: [connection("buda:research", "Research", "sess-latest")],
    });
    await screen.findByText("Research");
    const heading = screen.getByRole("heading", { name: "Choose an agent" });
    const connect = screen.getByRole("button", { name: "Connect an agent" });
    expect(heading.parentElement?.contains(connect)).toBe(true);
    expect(connect.getAttribute("title")).toBe("Connect an agent");
    expect(screen.getAllByRole("button", { name: "Connect an agent" })).toHaveLength(1);
    fireEvent.click(connect);
    expect(onNavigate).toHaveBeenCalledWith("/agents/new");
  });

  it("offers the header connect action while the connection list is loading", () => {
    const { onNavigate } = renderPicker({ orpc: stubOrpc(() => new Promise(() => {})) });
    fireEvent.click(screen.getByRole("button", { name: "Connect an agent" }));
    expect(onNavigate).toHaveBeenCalledWith("/agents/new");
  });

  it("shows a real loading state while connected agents are queried", async () => {
    renderPicker({ orpc: stubOrpc(() => new Promise(() => {})) });

    expect(await screen.findByText("Loading connected agents…")).toBeTruthy();
  });

  it("offers a retry when the connections query fails", async () => {
    const queryFn = vi
      .fn<() => Promise<AgentConnectionVO[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([connection("buda:research", "Research")]);
    renderPicker({ orpc: stubOrpc(queryFn) });

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: /^Research/ })).toBeTruthy();
  });

  it("routes an empty connection list to the connect-agent fallback", async () => {
    const onNavigate = vi.fn();
    renderPicker({ agents: [], onNavigate });

    expect(await screen.findByText("No agents connected yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect an agent" }));

    expect(onNavigate).toHaveBeenCalledWith("/agents/new");
  });

  it("opens the existing agent chat tab for the chosen connected agent", async () => {
    renderPicker({
      agents: [connection("buda:research", "Research", "sess-latest")],
    });

    fireEvent.click(await screen.findByRole("button", { name: /^Research/ }));

    expect(openAgentChatTab).toHaveBeenCalledWith("buda:research", "Research", {
      sessionId: "sess-latest",
    });
  });

  it("reuses connection cards and distinguishes saved authorization from disconnected history", async () => {
    const removed = {
      ...connection("acprouter:removed", "Retained desktop", "sess-history"),
      connected: false,
    };
    renderPicker({ agents: [connection("buda:research", "Research", "sess-latest"), removed] });
    expect(await screen.findByText("Retained desktop")).toBeTruthy();
    const list = screen.getByTestId("agent-connection-list");
    expect(list.getAttribute("role")).toBe("list");
    const entries = within(list).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(within(entries[0]).getByText("Connection saved")).toBeTruthy();
    expect(within(entries[1]).getByText("Disconnected")).toBeTruthy();
    expect(within(entries[1]).getByText("View history")).toBeTruthy();
    expect(within(entries[1]).getByTestId("agent-connection-indicator").dataset.state).toBe(
      "disconnected",
    );
    expect(list.textContent).not.toMatch(/\b\d+\s+sessions?\b/i);
    fireEvent.click(within(entries[1]).getByRole("button", { name: /^Retained desktop/ }));
    expect(openAgentChatTab).toHaveBeenCalledWith("acprouter:removed", "Retained desktop", {
      sessionId: "sess-history",
    });
  });

  it("shows current connection startup and preserves the separate connect action", async () => {
    const starting = connection("buda:research", "Research", "sess-starting");
    if (!starting.latest) throw new Error("Missing fixture session");
    starting.latest.status = "connecting";
    renderPicker({ agents: [starting] });
    expect(await screen.findByText("Connecting…")).toBeTruthy();
    const indicator = screen.getByTestId("agent-connection-indicator");
    expect(indicator.dataset.connecting).toBe("true");
    expect(indicator.classList.contains("motion-reduce:animate-none")).toBe(true);
    expect(screen.getByRole("button", { name: "Connect an agent" })).toBeTruthy();
    expect(screen.queryByText("Remote")).toBeNull();
    expect(screen.queryByText("Open chat")).toBeNull();
  });

  it("returns to the empty-state launcher via the back control", async () => {
    const onBack = vi.fn();
    renderPicker({ onBack });

    await screen.findByText("No agents connected yet.");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("offers the same More menu AgentsListView does — Connection details and Disconnect for an owned saved connection", async () => {
    renderPicker({ agents: [connection("buda:research", "Research", "sess-latest")] });

    await screen.findByText("Research");
    const trigger = await screen.findByRole("button", { name: "Actions for Research" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });

    expect(await screen.findByRole("menuitem", { name: "Connection" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Disconnect" })).toBeTruthy();
  });

  it("hides Rename and Disconnect for a shared, non-owned connection but still offers Connection details", async () => {
    const shared = {
      ...connection("buda:research", "Research", "sess-latest"),
      ownedByCurrentUser: false,
    };
    renderPicker({ agents: [shared] });

    await screen.findByText("Research");
    const trigger = await screen.findByRole("button", { name: "Actions for Research" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });

    expect(await screen.findByRole("menuitem", { name: "Connection" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Disconnect" })).toBeNull();
  });

  it("shows the real connector's name in the picker's connection details, not the viewer", async () => {
    renderPicker({
      agents: [connection("buda:research", "Research", "sess-latest")],
      orpc: stubOrpc(async () => [connection("buda:research", "Research", "sess-latest")], {
        detail: async () => ({
          ...DETAIL,
          connectedBy: { id: "owner-1", name: "Jordan Lee", email: null, image: null, role: null },
        }),
      }),
    });

    await screen.findByText("Research");
    const trigger = await screen.findByRole("button", { name: "Actions for Research" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Connection" }));

    const dialog = await screen.findByRole("dialog", { name: "Connection details" });
    expect(await within(dialog).findByText("Jordan Lee")).toBeTruthy();
  });

  it("disconnects a connection from the picker's shared menu, reusing the same confirmation copy", async () => {
    const disconnect = vi.fn<SlugMutation>(async (_input) => ({ ok: true }));
    renderPicker({
      agents: [connection("buda:research", "Research", "sess-latest")],
      orpc: stubOrpc(async () => [connection("buda:research", "Research", "sess-latest")], {
        disconnect,
      }),
    });

    await screen.findByText("Research");
    const trigger = await screen.findByRole("button", { name: "Actions for Research" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Disconnect" }));
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(disconnect.mock.calls[0]?.[0]).toEqual({ slug: "buda:research" }));
  });
});
