// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentCatalogEntryVO, AgentSessionVO } from "busabase-contract/domains/agents/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentsAddView } from "./agents-add-view";

/**
 * The Add Agent shell (Back + title) must stay mounted through loading, error,
 * empty, and populated catalog states — the page shouldn't disappear and
 * reappear on every request transition. The Buda overlay is now composed from
 * `kui/dialog`, so its accessibility contract (name, Escape, focus restore)
 * is asserted directly instead of trusting the old hand-built markup.
 */

const CLAUDE_ENTRY: AgentCatalogEntryVO = {
  slug: "claude-acp",
  name: "Claude Code",
  description: "Anthropic's Claude, wrapped for ACP. Runs on this machine.",
  transport: "local-subprocess",
  version: "1.0.0",
  available: true,
  comingSoon: false,
  unavailableReason: null,
  connectionRequired: false,
  connectedAgentName: null,
  connectedAgents: [],
};

const BUDA_ENTRY: AgentCatalogEntryVO = {
  slug: "buda",
  name: "Buda",
  description: "A hosted Buda agent. Runs in Buda's cloud — nothing is installed locally.",
  transport: "remote-websocket",
  version: null,
  available: false,
  comingSoon: false,
  unavailableReason: null,
  connectionRequired: true,
  connectedAgentName: null,
  connectedAgents: [],
};

const UNAVAILABLE_LOCAL_ENTRY: AgentCatalogEntryVO = {
  slug: "codex-acp",
  name: "Codex",
  description: "OpenAI's Codex, wrapped for ACP. Runs on this machine.",
  transport: "local-subprocess",
  version: null,
  available: false,
  comingSoon: false,
  unavailableReason: "Not available in Busabase Cloud.",
  connectionRequired: false,
  connectedAgentName: null,
  connectedAgents: [],
};

const SESSION: AgentSessionVO = {
  id: "sess-1",
  slug: "claude-acp",
  agentName: "Claude Code",
  transport: "local-subprocess",
  status: "idle",
  createdAt: "2026-09-15T00:00:00.000Z",
  lastActivityAt: "2026-09-15T00:00:00.000Z",
  error: null,
  modelOption: null,
};

type CreateSession = (input: { slug: string }) => Promise<AgentSessionVO>;

function stubOrpc(options: {
  catalog?: () => Promise<AgentCatalogEntryVO[]>;
  create?: ReturnType<typeof vi.fn<CreateSession>>;
}) {
  const catalogFn = options.catalog ?? (async () => [CLAUDE_ENTRY]);
  const create = options.create ?? vi.fn(async (_input: { slug: string }) => SESSION);
  return {
    agents: {
      catalog: {
        queryOptions: () => ({ queryKey: ["agents", "catalog"], queryFn: catalogFn }),
        queryKey: () => ["agents", "catalog"],
      },
      connections: {
        list: {
          queryKey: ({ input }: { input: { scope: string } }) => [
            "agents",
            "connections",
            input.scope,
          ],
        },
      },
      sessions: {
        list: { queryKey: () => ["agents", "sessions", "list"] },
        create: { mutationOptions: () => ({ mutationFn: create }) },
      },
    },
  } as unknown as BusabaseQueryUtils;
}

function renderView(options: {
  catalog?: () => Promise<AgentCatalogEntryVO[]>;
  create?: ReturnType<typeof vi.fn<CreateSession>>;
  onBack?: () => void;
  onConnected?: (slug: string) => void;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onBack = options.onBack ?? vi.fn();
  const onConnected = options.onConnected ?? vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AgentsAddView
        onBack={onBack}
        onConnected={onConnected}
        orpc={stubOrpc(options)}
        spaceId="space-1"
      />
    </QueryClientProvider>,
  );
  return { onBack, onConnected };
}

describe("AgentsAddView — persistent shell", () => {
  afterEach(cleanup);

  it("keeps Back and the title visible while the catalog loads", async () => {
    renderView({ catalog: () => new Promise(() => {}) });

    expect(screen.getByRole("button", { name: /Back/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Add agent" })).toBeTruthy();
  });

  it("keeps the shell mounted and offers retry when the catalog request fails", async () => {
    const catalog = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce([CLAUDE_ENTRY]);
    renderView({ catalog });

    expect(screen.getByRole("heading", { name: "Add agent" })).toBeTruthy();
    const retry = await screen.findByRole("button", { name: "Retry" });

    fireEvent.click(retry);

    await screen.findByText("Claude Code");
    expect(screen.getByRole("heading", { name: "Add agent" })).toBeTruthy();
  });

  it("shows an explicit empty state with retry when the catalog has no entries", async () => {
    const catalog = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([CLAUDE_ENTRY]);
    renderView({ catalog });

    expect(await screen.findByText("No agents available")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Add agent" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await screen.findByText("Claude Code");
  });

  it("calls onBack from the persistent header", async () => {
    const { onBack } = renderView({});
    await screen.findByText("Claude Code");

    fireEvent.click(screen.getByRole("button", { name: /Back/ }));

    expect(onBack).toHaveBeenCalled();
  });
});

describe("AgentsAddView — session creation feedback", () => {
  afterEach(cleanup);

  it("continues to Agent Detail when Connect succeeds", async () => {
    const create = vi.fn(async (_input: { slug: string }) => SESSION);
    const { onConnected } = renderView({ create });
    await screen.findByText("Claude Code");

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(create.mock.calls[0]?.[0]).toEqual({ slug: "claude-acp" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("claude-acp"));
  });

  it("surfaces a localized error on the entry that failed and allows retry", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("Agent is shutting down."))
      .mockResolvedValueOnce(SESSION);
    const { onConnected } = renderView({ create });
    await screen.findByText("Claude Code");

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText("Agent is shutting down.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("claude-acp"));
    expect(screen.queryByText("Agent is shutting down.")).toBeNull();
  });
});

describe("AgentsAddView — unavailable local agent styling", () => {
  afterEach(cleanup);

  it("applies the disabled-card treatment to a local agent unavailable on this host", async () => {
    renderView({ catalog: async () => [UNAVAILABLE_LOCAL_ENTRY] });

    await screen.findByText("Codex");
    const card = document.querySelector('[data-agent-slug="codex-acp"]');
    expect(card).toBeTruthy();
    expect(card?.className).toContain("opacity-50");
    expect(card?.className).toContain("grayscale-[50%]");
  });

  it("does not apply the disabled-card treatment to an available local agent", async () => {
    renderView({ catalog: async () => [CLAUDE_ENTRY] });

    await screen.findByText("Claude Code");
    const card = document.querySelector('[data-agent-slug="claude-acp"]');
    expect(card).toBeTruthy();
    expect(card?.className).not.toContain("opacity-50");
  });

  it("does not apply the disabled-card treatment to a connection-required agent (e.g. Buda)", async () => {
    renderView({ catalog: async () => [BUDA_ENTRY] });

    await screen.findByRole("button", { name: "Sign in to Buda" });
    const card = document.querySelector('[data-agent-slug="buda"]');
    expect(card).toBeTruthy();
    expect(card?.className).not.toContain("opacity-50");
  });
});

describe("AgentsAddView — Buda connection dialog", () => {
  afterEach(cleanup);

  it("opens as an accessible dialog naming Connect Buda and restores focus on close", async () => {
    renderView({ catalog: async () => [BUDA_ENTRY] });
    const signIn = await screen.findByRole("button", { name: "Sign in to Buda" });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    signIn.focus();
    fireEvent.click(signIn);

    const dialog = await screen.findByRole("dialog", { name: "Connect Buda" });
    expect(dialog).toBeTruthy();
    expect(openSpy).toHaveBeenCalledWith(
      "/api/agents/buda/oauth/start?spaceId=space-1",
      "busabase-buda-oauth",
      "popup,width=560,height=760",
    );

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(signIn));
  });

  it("keeps the dialog open with recovery guidance when the popup is blocked", async () => {
    renderView({ catalog: async () => [BUDA_ENTRY] });
    vi.spyOn(window, "open").mockReturnValue(null);

    const signIn = await screen.findByRole("button", { name: "Sign in to Buda" });
    signIn.focus();
    fireEvent.click(signIn);

    const dialog = await screen.findByRole("dialog", { name: "Connect Buda" });
    expect(await screen.findByText("Allow popups for Busabase, then try again.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Connect Buda" })).toBeTruthy();

    const retry = screen.getByRole("button", { name: "Open Buda" });
    retry.focus();
    fireEvent.click(retry);
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(signIn));
  });

  it("closes the dialog and starts a session on a successful OAuth message", async () => {
    const budaSession = { ...SESSION, slug: "buda-agent-1", agentName: "Buda Agent" };
    const create = vi.fn(async (_input: { slug: string }) => budaSession);
    const { onConnected } = renderView({ catalog: async () => [BUDA_ENTRY], create });
    vi.spyOn(window, "open").mockReturnValue(null);

    fireEvent.click(await screen.findByRole("button", { name: "Sign in to Buda" }));
    await screen.findByRole("dialog", { name: "Connect Buda" });

    fireEvent(
      window,
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { type: "busabase:buda-connected", slug: "buda-agent-1" },
      }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(create.mock.calls[0]?.[0]).toEqual({ slug: "buda-agent-1" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("buda-agent-1"));
  });

  it("ignores a message from an untrusted origin", async () => {
    renderView({ catalog: async () => [BUDA_ENTRY] });
    vi.spyOn(window, "open").mockReturnValue(null);

    fireEvent.click(await screen.findByRole("button", { name: "Sign in to Buda" }));
    await screen.findByRole("dialog", { name: "Connect Buda" });

    fireEvent(
      window,
      new MessageEvent("message", {
        origin: "https://evil.example",
        data: { type: "busabase:buda-connected", slug: "buda-agent-1" },
      }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeTruthy());
  });
});
