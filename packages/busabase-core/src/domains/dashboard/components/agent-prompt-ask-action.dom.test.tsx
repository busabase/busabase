// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentConnectionVO, AgentSessionVO } from "busabase-contract/domains/agents/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { resetNodeAgentSessions } from "../../agents/utils/node-agent-sessions";

const openAgentChatTab = vi.fn();
const setLocation = vi.fn();

vi.mock("wouter", () => ({ useLocation: () => ["/", setLocation] }));
vi.mock("./side-panel-sources", () => ({ openAgentChatTab }));

const { AgentPromptAskAction } = await import("./agent-prompt-ask-action");

const session = (id: string, slug: string, agentName: string): AgentSessionVO => ({
  id,
  slug,
  agentName,
  transport: "remote-websocket",
  status: "idle",
  createdAt: "2026-09-16T00:00:00.000Z",
  lastActivityAt: "2026-09-16T00:00:00.000Z",
  error: null,
  modelOption: null,
});

const connection = (slug: string, agentName: string, connected = true): AgentConnectionVO => ({
  slug,
  agentName,
  transport: "remote-websocket",
  sessionCount: 0,
  latest: null,
  connected,
  ownedByCurrentUser: true,
});

function stubOrpc({
  connections,
  sessions = [],
  create = vi.fn(async ({ slug }: { slug: string }) => {
    const created = session(`sess-${slug}`, slug, slug);
    sessions.push(created);
    return created;
  }),
  catalog = vi.fn(async () => []),
}: {
  connections: () => Promise<AgentConnectionVO[]>;
  sessions?: AgentSessionVO[];
  create?: ReturnType<typeof vi.fn>;
  catalog?: ReturnType<typeof vi.fn>;
}) {
  return {
    orpc: {
      agents: {
        catalog: {
          queryOptions: () => ({ queryKey: ["agents", "catalog"], queryFn: catalog }),
        },
        connections: {
          list: {
            queryOptions: ({ input }: { input: { scope: string } }) => ({
              queryKey: ["agents", "connections", input.scope],
              queryFn: connections,
            }),
          },
        },
        sessions: {
          list: {
            queryKey: () => ["agents", "sessions", "list"],
            queryOptions: () => ({
              queryKey: ["agents", "sessions", "list"],
              queryFn: async () => sessions,
            }),
          },
          create: { mutationOptions: () => ({ mutationFn: create }) },
        },
      },
    } as unknown as BusabaseQueryUtils,
    catalog,
    create,
  };
}

function renderAction({
  orpc,
  promptText = "Review the selected document.",
  onHandedOff = vi.fn(),
}: {
  orpc: BusabaseQueryUtils;
  promptText?: string;
  onHandedOff?: () => void;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = (text: string) => (
    <CoreI18nProvider locale="en">
      <QueryClientProvider client={client}>
        <AgentPromptAskAction
          onHandedOff={onHandedOff}
          orpc={orpc}
          promptText={text}
          sessionScopeId="nod_report"
        />
      </QueryClientProvider>
    </CoreI18nProvider>
  );
  const rendered = render(view(promptText));
  return { ...rendered, rerenderPrompt: (text: string) => rendered.rerender(view(text)) };
}

function openAgentMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Ask Agent options" }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
}

afterEach(() => {
  cleanup();
  resetNodeAgentSessions();
  openAgentChatTab.mockReset();
  setLocation.mockReset();
});

describe("AgentPromptAskAction", () => {
  it("renders a secondary XS split action with the options chevron on the right", async () => {
    const { orpc } = stubOrpc({
      connections: async () => [connection("buda:research", "Research")],
    });
    renderAction({ orpc });

    const primary = screen.getByRole("button", { name: "Ask Agent" });
    const options = screen.getByRole("button", { name: "Ask Agent options" });
    await waitFor(() => expect((primary as HTMLButtonElement).disabled).toBe(false));
    expect(primary.className).toContain("h-7");
    expect(primary.className).toContain("text-xs");
    expect(primary.className).toContain("bg-secondary");
    expect(options.className).toContain("h-7");
    expect(
      primary.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("uses the single connected Agent directly and reuses the scoped session with a fresh draft", async () => {
    const sessions: AgentSessionVO[] = [];
    const { orpc, catalog, create } = stubOrpc({
      connections: async () => [connection("buda:research", "Research")],
      sessions,
    });
    const onHandedOff = vi.fn();
    const { rerenderPrompt } = renderAction({ orpc, onHandedOff, promptText: "Prompt A" });

    const primary = screen.getByRole("button", { name: "Ask Agent" });
    await waitFor(() => expect((primary as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(primary);

    await waitFor(() => expect(openAgentChatTab).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(1);
    expect(catalog).not.toHaveBeenCalled();
    expect(openAgentChatTab).toHaveBeenLastCalledWith("buda:research", "Research", {
      sessionId: "sess-buda:research",
      draft: { id: expect.stringMatching(/^ask-agent-/), text: "Prompt A" },
    });
    expect(onHandedOff).toHaveBeenCalledTimes(1);

    rerenderPrompt("Prompt B");
    fireEvent.click(screen.getByRole("button", { name: "Ask Agent" }));

    await waitFor(() => expect(openAgentChatTab).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenCalledTimes(1);
    expect(openAgentChatTab).toHaveBeenLastCalledWith("buda:research", "Research", {
      sessionId: "sess-buda:research",
      draft: { id: expect.stringMatching(/^ask-agent-/), text: "Prompt B" },
    });
  });

  it("lists only connected Agents and hands the current prompt to the selected target", async () => {
    const { orpc, catalog } = stubOrpc({
      connections: async () => [
        connection("buda:research", "Research"),
        connection("buda:offline", "Offline", false),
        connection("buda:writer", "Writer"),
      ],
    });
    renderAction({ orpc, promptText: "Rendered dispatch prompt" });

    const primary = screen.getByRole("button", { name: "Ask Agent" });
    await waitFor(() => expect((primary as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(primary);
    expect(await screen.findByText("Ask Agent Directly")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Offline" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Writer" }));

    await waitFor(() =>
      expect(openAgentChatTab).toHaveBeenCalledWith("buda:writer", "Writer", {
        sessionId: "sess-buda:writer",
        draft: { id: expect.stringMatching(/^ask-agent-/), text: "Rendered dispatch prompt" },
      }),
    );
    expect(catalog).not.toHaveBeenCalled();
  });

  it("supports keyboard opening, Agent focus, Escape, and trigger restoration", async () => {
    const { orpc } = stubOrpc({
      connections: async () => [
        connection("buda:research", "Research"),
        connection("buda:writer", "Writer"),
      ],
    });
    renderAction({ orpc });

    const trigger = screen.getByRole("button", { name: "Ask Agent options" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const research = await screen.findByRole("menuitem", { name: "Research" });
    fireEvent.keyDown(document.activeElement ?? trigger, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(research));

    fireEvent.keyDown(research, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Research" })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("shows a disabled loading row while space connections are pending", async () => {
    const { orpc } = stubOrpc({ connections: () => new Promise(() => {}) });
    renderAction({ orpc });

    openAgentMenu();

    const loading = await screen.findByRole("menuitem", { name: "Finding your agents…" });
    expect(loading.getAttribute("aria-disabled")).toBe("true");
  });

  it("shows loading, retry, and empty setup states in the Agent menu", async () => {
    const query = vi
      .fn<() => Promise<AgentConnectionVO[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([]);
    const { orpc } = stubOrpc({ connections: query });
    const onHandedOff = vi.fn();
    renderAction({ orpc, onHandedOff });

    openAgentMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Try again" }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));

    openAgentMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "No agent is connected yet." }));
    expect(onHandedOff).toHaveBeenCalledTimes(1);
    expect(setLocation).toHaveBeenCalledWith("/agents/new");
  });

  it("routes the main action to setup when the successful connection list is empty", async () => {
    const { orpc } = stubOrpc({ connections: async () => [] });
    const onHandedOff = vi.fn();
    renderAction({ orpc, onHandedOff });

    const primary = screen.getByRole("button", { name: "Ask Agent" });
    await waitFor(() => expect((primary as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(primary);

    expect(onHandedOff).toHaveBeenCalledTimes(1);
    expect(setLocation).toHaveBeenCalledWith("/agents/new");
  });
});
