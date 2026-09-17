// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentConnectionVO } from "busabase-contract/domains/agents/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, type CoreLocale } from "../../../i18n";
import { DashboardOrpcProvider } from "../orpc-context";

const openAgentChatTab = vi.fn();
const setLocation = vi.fn();

vi.mock("wouter", () => ({ useLocation: () => ["/", setLocation] }));
vi.mock("./side-panel-sources", () => ({ openAgentChatTab }));
vi.mock("./node-agent-prompts-dialog", () => ({
  NodeAgentPromptsDialog: () => <div role="dialog">Agent prompts dialog</div>,
}));

const { NodeAgentPromptsButton } = await import("./node-agent-prompts-button");

const connection = (
  slug: string,
  agentName: string,
  options: { connected?: boolean; latestSessionId?: string } = {},
): AgentConnectionVO => ({
  slug,
  agentName,
  transport: "remote-websocket",
  sessionCount: options.latestSessionId ? 1 : 0,
  latest: options.latestSessionId
    ? {
        id: options.latestSessionId,
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
  connected: options.connected ?? true,
  ownedByCurrentUser: true,
});

const stubOrpc = (queryFn: () => Promise<AgentConnectionVO[]>) =>
  ({
    agents: {
      connections: {
        list: {
          queryOptions: () => ({
            queryKey: ["agents", "connections"],
            queryFn,
          }),
        },
      },
    },
  }) as unknown as BusabaseQueryUtils;

function renderButton({
  agents = [],
  locale = "en",
  orpc = stubOrpc(async () => agents),
  contextOrpc,
}: {
  agents?: AgentConnectionVO[];
  locale?: CoreLocale;
  orpc?: BusabaseQueryUtils | null;
  /** Wraps the button in `DashboardOrpcProvider` with this value when set, the
   *  same way every real node-detail toolbar (including scoped ones like
   *  `RecordTopbarActions`) is mounted. */
  contextOrpc?: BusabaseQueryUtils;
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = (children: ReactNode) => (
    <CoreI18nProvider locale={locale}>
      <QueryClientProvider client={client}>
        {contextOrpc ? (
          <DashboardOrpcProvider orpc={contextOrpc}>{children}</DashboardOrpcProvider>
        ) : (
          children
        )}
      </QueryClientProvider>
    </CoreI18nProvider>
  );

  return render(
    wrapper(
      <NodeAgentPromptsButton
        nodeId="nod_report"
        nodeName="Quarterly report"
        nodeType="doc"
        orpc={orpc}
      />,
    ),
  );
}

function openActionsMenu() {
  fireEvent.pointerDown(screen.getByTestId("node-agent-actions-trigger"), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
}

afterEach(() => {
  cleanup();
  openAgentChatTab.mockReset();
  setLocation.mockReset();
});

describe("NodeAgentPromptsButton", () => {
  it("keeps Agent prompts as the labelled primary action", () => {
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Agent prompts" }));

    expect(screen.getByRole("dialog", { name: "" })).toBeTruthy();
  });

  it("gives the Ask Agent options trigger a unique localized label", () => {
    renderButton({ locale: "zh-TW" });

    expect(screen.getByRole("button", { name: "選擇要交給哪個 Agent" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "更多操作" })).toBeNull();
  });

  it("omits the unavailable split action instead of showing endless loading", () => {
    renderButton({ orpc: null });

    expect(screen.getByRole("button", { name: "Agent prompts" })).toBeTruthy();
    expect(screen.queryByTestId("node-agent-actions-trigger")).toBeNull();
    expect(screen.queryByText("Finding your agents…")).toBeNull();
  });

  it("still shows the dropdown for a scoped caller's orpc={null} when a DashboardOrpcProvider wraps it", async () => {
    // Regression for PUL-240: `RecordTopbarActions` on /base/companies/<record>
    // passes `orpc={null}` to skip its own custom-prompts fetch (see that
    // component's doc), but the record page mounts inside the same
    // `DashboardOrpcProvider` as the folder/pipeline page. The split button's
    // chevron dropdown must come from that context, not disappear just
    // because the scoped caller's own `orpc` prop is `null`.
    renderButton({ orpc: null, contextOrpc: stubOrpc(async () => []) });

    expect(screen.getByRole("button", { name: "Agent prompts" })).toBeTruthy();
    expect(screen.getByTestId("node-agent-actions-trigger")).toBeTruthy();

    openActionsMenu();
    expect(
      await screen.findByRole("menuitem", { name: "No agent is connected yet." }),
    ).toBeTruthy();
  });

  it("shows a real loading state while connected Agents are queried", async () => {
    renderButton({ orpc: stubOrpc(() => new Promise(() => {})) });

    openActionsMenu();

    const loading = await screen.findByRole("menuitem", { name: "Finding your agents…" });
    expect(loading.getAttribute("aria-disabled")).toBe("true");
  });

  it("routes zero or disconnected Agents to connection setup", async () => {
    renderButton({ agents: [connection("buda:offline", "Offline", { connected: false })] });

    openActionsMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "No agent is connected yet." }));

    expect(setLocation).toHaveBeenCalledWith("/agents/new");
    expect(openAgentChatTab).not.toHaveBeenCalled();
  });

  it("retries a failed Agent query and exposes the recovered action", async () => {
    const queryFn = vi
      .fn<() => Promise<AgentConnectionVO[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([connection("buda:research", "Research")]);
    renderButton({ orpc: stubOrpc(queryFn) });

    openActionsMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Try again" }));
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));

    openActionsMenu();
    await waitFor(() => {
      expect(screen.getByText("Ask Agent Directly")).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Research" })).toBeTruthy();
    });
  });

  it("opens the only connected Agent and reuses its latest session", async () => {
    renderButton({
      agents: [connection("buda:research", "Research", { latestSessionId: "sess-latest" })],
    });

    openActionsMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Research" }));

    expect(openAgentChatTab).toHaveBeenCalledWith("buda:research", "Research", {
      sessionId: "sess-latest",
    });
  });

  it("shows the list header even with exactly one connected Agent", async () => {
    renderButton({
      agents: [connection("buda:research", "Research", { latestSessionId: "sess-latest" })],
    });

    openActionsMenu();

    expect(await screen.findByText("Ask Agent Directly")).toBeTruthy();
    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("max-h-80");
    expect(menu.className).toContain("w-56");
    expect(menu.className).toContain("overflow-y-auto");
    expect(await screen.findByRole("menuitem", { name: "Research" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Ask Agent Directly" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Ask Agent" })).toBeNull();
  });

  it("supports keyboard focus across the flat Agent list, selection, closing, and trigger restoration", async () => {
    renderButton({
      agents: [connection("buda:research", "Research"), connection("buda:writer", "Writer")],
    });

    const trigger = screen.getByRole("button", { name: "Ask Agent options" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const research = await screen.findByRole("menuitem", { name: "Research" });
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    fireEvent.keyDown(document.activeElement ?? trigger, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(research));

    fireEvent.keyDown(research, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Research" })).toBeNull());
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const reopenedResearch = await screen.findByRole("menuitem", { name: "Research" });
    fireEvent.keyDown(document.activeElement ?? trigger, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(reopenedResearch));
    fireEvent.keyDown(reopenedResearch, { key: "ArrowDown" });
    const writer = await screen.findByRole("menuitem", { name: "Writer" });
    await waitFor(() => expect(document.activeElement).toBe(writer));
    fireEvent.keyDown(writer, { key: "Enter" });

    await waitFor(() =>
      expect(openAgentChatTab).toHaveBeenCalledWith("buda:writer", "Writer", {
        sessionId: undefined,
      }),
    );
    expect(screen.queryByRole("menuitem", { name: "Writer" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
