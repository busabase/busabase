// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentConnectionVO } from "busabase-contract/domains/agents/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { createKnownNodeCache } from "../helpers/known-node-cache";

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

const stubOrpc = (queryFn: () => Promise<AgentConnectionVO[]>) =>
  ({
    agents: {
      connections: {
        list: {
          queryOptions: () => ({ queryKey: ["agents", "connections"], queryFn }),
        },
      },
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
    expect(await screen.findByRole("button", { name: /Research/ })).toBeTruthy();
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

    fireEvent.click(await screen.findByRole("button", { name: /Research/ }));

    expect(openAgentChatTab).toHaveBeenCalledWith("buda:research", "Research", {
      sessionId: "sess-latest",
    });
  });

  it("returns to the empty-state launcher via the back control", async () => {
    const onBack = vi.fn();
    renderPicker({ onBack });

    await screen.findByText("No agents connected yet.");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
