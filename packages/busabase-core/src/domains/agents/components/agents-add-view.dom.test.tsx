// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AgentCatalogEntryVO,
  AgentConnectionVO,
  AgentSessionVO,
} from "busabase-contract/domains/agents/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentsAddView } from "./agents-add-view";

const desktop = vi.hoisted(() => ({
  request: vi.fn(async (_slug: string, _action: string) => null as unknown),
}));
vi.mock("../utils/desktop-codex", () => ({ requestDesktopAgent: desktop.request }));

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

const CLAUDE_CONNECTION: AgentConnectionVO = {
  slug: "claude-acp",
  agentName: "Claude Code",
  transport: "local-subprocess",
  sessionCount: 1,
  latest: SESSION,
  connected: true,
  ownedByCurrentUser: true,
};

type CreateSession = (input: { slug: string }) => Promise<AgentSessionVO>;

function stubOrpc(options: {
  catalog?: () => Promise<AgentCatalogEntryVO[]>;
  connections?: () => Promise<AgentConnectionVO[]>;
  create?: ReturnType<typeof vi.fn<CreateSession>>;
}) {
  const catalogFn = options.catalog ?? (async () => [CLAUDE_ENTRY]);
  const connections = options.connections ?? (async () => []);
  const create = options.create ?? vi.fn(async (_input: { slug: string }) => SESSION);
  return {
    agents: {
      routerEnrollment: {
        grants: { queryOptions: () => ({ queryKey: ["router-grants"], queryFn: async () => [] }) },
        status: {
          queryOptions: () => ({ queryKey: ["router-status"], queryFn: async () => null }),
        },
        mint: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
        cancel: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
        complete: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      },
      catalog: {
        queryOptions: () => ({ queryKey: ["agents", "catalog"], queryFn: catalogFn }),
        queryKey: () => ["agents", "catalog"],
      },
      connections: {
        list: {
          queryOptions: () => ({
            queryKey: ["agents", "connections", "mine"],
            queryFn: connections,
          }),
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
  connections?: () => Promise<AgentConnectionVO[]>;
  create?: ReturnType<typeof vi.fn<CreateSession>>;
  onBack?: () => void;
  onConnected?: (slug: string) => void;
  spaceId?: string;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onBack = options.onBack ?? vi.fn();
  const onConnected = options.onConnected ?? vi.fn();
  const orpc = stubOrpc(options);
  const rendered = render(
    <QueryClientProvider client={client}>
      <AgentsAddView
        onBack={onBack}
        onConnected={onConnected}
        orpc={orpc}
        spaceId={options.spaceId ?? "space-1"}
      />
    </QueryClientProvider>,
  );
  return { onBack, onConnected, client, orpc, ...rendered };
}

describe("AgentsAddView — persistent shell", () => {
  afterEach(() => {
    cleanup();
    desktop.request.mockReset();
    desktop.request.mockResolvedValue(null);
  });

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
  afterEach(() => {
    cleanup();
    desktop.request.mockReset();
    desktop.request.mockResolvedValue(null);
  });

  it("continues to Agent Detail when Connect succeeds", async () => {
    const create = vi.fn(async (_input: { slug: string }) => SESSION);
    const { onConnected } = renderView({ create });
    await screen.findByText("Claude Code");

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(create.mock.calls[0]?.[0]).toEqual({ slug: "claude-acp" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("claude-acp"));
  });

  it("disables a local agent that has already been added", async () => {
    const create = vi.fn(async (_input: { slug: string }) => SESSION);
    renderView({ connections: async () => [CLAUDE_CONNECTION], create });

    await screen.findByText("Claude Code");
    const connect = await screen.findByRole("button", { name: "Connect" });
    expect((connect as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-agent-slug="claude-acp"]')?.className).toContain(
      "opacity-50",
    );
    fireEvent.click(connect);
    expect(create).not.toHaveBeenCalled();
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
  afterEach(() => {
    cleanup();
    desktop.request.mockReset();
    desktop.request.mockResolvedValue(null);
  });

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

    await screen.findByRole("button", { name: "Connect Buda" });
    const card = document.querySelector('[data-agent-slug="buda"]');
    expect(card).toBeTruthy();
    expect(card?.className).not.toContain("opacity-50");
  });
});

describe("AgentsAddView — card ordering", () => {
  afterEach(() => {
    cleanup();
    desktop.request.mockReset();
    desktop.request.mockResolvedValue(null);
  });

  const cardSlugs = () =>
    Array.from(document.querySelectorAll("[data-agent-slug]")).map((card) =>
      card.getAttribute("data-agent-slug"),
    );

  it("moves disabled local agents after an actionable Buda, keeping catalog order within each group", async () => {
    // Mirrors the reported layout: Buda is actionable, Claude/Codex are
    // disabled (unavailable on this host), and catalog order already lists
    // Claude before Codex and Buda last.
    const claudeDisabled = {
      ...CLAUDE_ENTRY,
      available: false,
      unavailableReason: "Not available in Busabase Cloud.",
    };
    const routerEntry = { ...BUDA_ENTRY, slug: "acprouter", name: "ACPRouter Agent" };
    const catalog = [BUDA_ENTRY, claudeDisabled, UNAVAILABLE_LOCAL_ENTRY, routerEntry];
    renderView({ catalog: async () => catalog });

    await screen.findByRole("button", { name: "Connect Buda" });

    expect(cardSlugs()).toEqual(["buda", "acprouter", "claude-acp", "codex-acp"]);
    expect(catalog.map((entry) => entry.slug)).toEqual([
      "buda",
      "claude-acp",
      "codex-acp",
      "acprouter",
    ]);
  });

  it("moves a desktop-detected local agent ahead of unavailable cards", async () => {
    desktop.request.mockImplementation(async (slug: string) =>
      slug === "codex-acp"
        ? { source: "managed", installed: false, codex: "missing", auth: "unknown" }
        : null,
    );
    renderView({
      catalog: async () => [
        { ...CLAUDE_ENTRY, available: false },
        UNAVAILABLE_LOCAL_ENTRY,
        BUDA_ENTRY,
      ],
    });
    await waitFor(() => expect(cardSlugs()).toEqual(["codex-acp", "buda", "claude-acp"]));
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
  });

  it("leaves order untouched when every card is already actionable", async () => {
    renderView({ catalog: async () => [CLAUDE_ENTRY, BUDA_ENTRY] });

    await screen.findByText("Claude Code");

    expect(cardSlugs()).toEqual(["claude-acp", "buda"]);
  });

  it("sinks a comingSoon card below actionable ones regardless of catalog position", async () => {
    const comingSoonFirst = {
      ...UNAVAILABLE_LOCAL_ENTRY,
      comingSoon: true,
      unavailableReason: null,
    };
    renderView({ catalog: async () => [comingSoonFirst, CLAUDE_ENTRY, BUDA_ENTRY] });

    await screen.findByText("Claude Code");

    expect(cardSlugs()).toEqual(["claude-acp", "buda", "codex-acp"]);
  });

  it("sinks an already-added local agent below still-actionable cards", async () => {
    renderView({
      catalog: async () => [CLAUDE_ENTRY, BUDA_ENTRY],
      connections: async () => [CLAUDE_CONNECTION],
    });

    await screen.findByRole("button", { name: "Connect Buda" });

    expect(cardSlugs()).toEqual(["buda", "claude-acp"]);
  });
});

describe("AgentsAddView — Desktop Codex installation", () => {
  afterEach(() => {
    cleanup();
    desktop.request.mockReset();
    desktop.request.mockResolvedValue(null);
  });

  it("asks for confirmation before installing and does not create a session when CLI is missing", async () => {
    desktop.request.mockResolvedValue({
      source: "managed",
      installed: false,
      codex: "missing",
      auth: "unknown",
    });
    const create = vi.fn(async (_input: { slug: string }) => SESSION);
    renderView({ catalog: async () => [UNAVAILABLE_LOCAL_ENTRY], create });
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("dialog", { name: "Install Codex ACP?" })).toBeTruthy();
    expect(desktop.request).not.toHaveBeenCalledWith("codex-acp", "install");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(create).not.toHaveBeenCalled();
  });

  it("installs after confirmation and shows CLI guidance without a false session", async () => {
    desktop.request.mockImplementation(async (_slug: string, action: string) =>
      action === "install"
        ? { source: "managed", installed: true, codex: "login_required", auth: "login_required" }
        : { source: "managed", installed: false, codex: "missing", auth: "unknown" },
    );
    const create = vi.fn(async (_input: { slug: string }) => SESSION);
    renderView({ catalog: async () => [UNAVAILABLE_LOCAL_ENTRY], create });
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    fireEvent.click(await screen.findByRole("button", { name: "Install and connect" }));
    await screen.findByText(/codex login/);
    expect(desktop.request).toHaveBeenCalledWith("codex-acp", "install");
    expect(create).not.toHaveBeenCalled();
  });

  it("confirms Claude installation, then offers terminal login without creating a session", async () => {
    desktop.request.mockImplementation(async (_slug: string, action: string) =>
      action === "install"
        ? { source: "managed", installed: true, auth: "login_required" }
        : { source: "managed", installed: false, auth: "unknown" },
    );
    const create = vi.fn(async (_input: { slug: string }) => SESSION);
    renderView({ catalog: async () => [CLAUDE_ENTRY], create });
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("dialog", { name: "Install Claude Code ACP?" })).toBeTruthy();
    expect(desktop.request).not.toHaveBeenCalledWith("claude-acp", "install");
    fireEvent.click(screen.getByRole("button", { name: "Install and connect" }));
    await screen.findByText(/claude.*login/i);
    expect(desktop.request).toHaveBeenCalledWith("claude-acp", "install");
    expect(create).not.toHaveBeenCalled();
  });

  it("retries a failed Claude installation", async () => {
    let attempts = 0;
    desktop.request.mockImplementation(async (_slug: string, action: string) => {
      if (action === "status") return { source: "managed", installed: false, auth: "unknown" };
      attempts++;
      if (attempts === 1) throw new Error("Download interrupted");
      return { source: "managed", installed: true, auth: "ready" };
    });
    const create = vi.fn(async (_input: { slug: string }) => SESSION);
    const { onConnected } = renderView({ catalog: async () => [CLAUDE_ENTRY], create });
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    fireEvent.click(await screen.findByRole("button", { name: "Install and connect" }));
    await waitFor(() => expect(screen.getAllByText("Download interrupted")).toHaveLength(2));
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry installation" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("claude-acp"));
    expect(attempts).toBe(2);
  });
});

describe("AgentsAddView — Buda connection dialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  function popup() {
    return { closed: false, close: vi.fn() } as unknown as Window;
  }

  async function authorize(options: Parameters<typeof renderView>[0] = {}) {
    const create = options.create ?? vi.fn(async (_input: { slug: string }) => SESSION);
    const view = renderView({ ...options, catalog: async () => [BUDA_ENTRY], create });
    const opened = popup();
    const open = vi.spyOn(window, "open").mockReturnValue(opened);
    fireEvent.click(await screen.findByRole("button", { name: "Connect Buda" }));
    await screen.findByRole("dialog", { name: "Connect Buda" });
    const url = new URL(String(open.mock.calls[0]?.[0]));
    const flowId = url.searchParams.get("flowId");
    const send = (data: Record<string, unknown>, event: Partial<MessageEventInit> = {}) =>
      fireEvent(
        window,
        new MessageEvent("message", {
          origin: url.origin,
          source: opened,
          data: { flowId, ...data },
          ...event,
        }),
      );
    return { ...view, create, open, opened, url, flowId, send };
  }

  it("opens as an accessible dialog naming Connect Buda and restores focus on close", async () => {
    renderView({ catalog: async () => [BUDA_ENTRY] });
    const signIn = await screen.findByRole("button", { name: "Connect Buda" });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    signIn.focus();
    fireEvent.click(signIn);

    const dialog = await screen.findByRole("dialog", { name: "Connect Buda" });
    expect(dialog).toBeTruthy();
    const url = new URL(String(openSpy.mock.calls[0]?.[0]));
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe("/api/agents/buda/oauth/start");
    expect(url.searchParams.get("spaceId")).toBe("space-1");
    expect(url.searchParams.get("returnOrigin")).toBe(window.location.origin);
    expect(openSpy.mock.calls[0]?.[1]).toBe(
      `busabase-buda-oauth-${url.searchParams.get("flowId")}`,
    );

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(signIn));
  });

  it("keeps the dialog open with recovery guidance when the popup is blocked", async () => {
    renderView({ catalog: async () => [BUDA_ENTRY] });
    vi.spyOn(window, "open").mockReturnValue(null);

    const signIn = await screen.findByRole("button", { name: "Connect Buda" });
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
    const { onConnected, send } = await authorize({ create });
    send({ type: "busabase:buda-connected", slug: "buda-agent-1" });
    send({ type: "busabase:buda-connected", slug: "buda-agent-1" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(create.mock.calls[0]?.[0]).toEqual({ slug: "buda-agent-1" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("buda-agent-1"));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("ignores a message from an untrusted origin", async () => {
    const { send, create } = await authorize();
    send(
      { type: "busabase:buda-connected", slug: "buda-agent-1" },
      { origin: "https://evil.example" },
    );
    expect(screen.queryByRole("dialog")).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it("opens the configured main origin and prevents duplicate authorization", async () => {
    vi.stubGlobal("__SHARELIB_PUBLIC_ENV__", { appUrl: "https://busabase.com/path" });
    const { url, flowId, open } = await authorize();
    expect(url.origin).toBe("https://busabase.com");
    expect(flowId).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Open Buda" }).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Buda" }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe(
      "Complete Buda authorization in the new window…",
    );
  });

  it("requires the exact popup and flow, ignoring messages after recovery or completion", async () => {
    const { send, create, flowId } = await authorize();
    const success = { type: "busabase:buda-connected", slug: "buda-agent-1" };
    send(success, { source: popup() });
    send({ ...success, flowId: "another-flow" });
    send(success, { source: null });
    expect(create).not.toHaveBeenCalled();
    send({ type: "busabase:buda-error", reason: "access_denied" });
    expect(screen.getByRole("alert").textContent).toBe(
      "Buda authorization was declined. Try again when ready.",
    );
    send({ ...success, flowId });
    expect(create).not.toHaveBeenCalled();
  });

  it("uses a fresh flow and popup after rejection and ignores the old callback", async () => {
    const { send, create, open, url, opened } = await authorize();
    send({ type: "busabase:buda-error", reason: "access_denied" });
    const second = popup();
    open.mockReturnValue(second);
    fireEvent.click(screen.getByRole("button", { name: "Open Buda" }));
    const nextUrl = new URL(String(open.mock.calls[1]?.[0]));
    expect(nextUrl.searchParams.get("flowId")).not.toBe(url.searchParams.get("flowId"));
    expect(open.mock.calls[1]?.[1]).not.toBe(open.mock.calls[0]?.[1]);
    send({ type: "busabase:buda-connected", slug: "buda-agent-1" }, { source: opened });
    expect(create).not.toHaveBeenCalled();
    fireEvent(
      window,
      new MessageEvent("message", {
        origin: nextUrl.origin,
        source: second,
        data: {
          type: "busabase:buda-connected",
          slug: "buda-agent-1",
          flowId: nextUrl.searchParams.get("flowId"),
        },
      }),
    );
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });

  it("does not display server-supplied HTML or prototype keys as error messages", async () => {
    const { send } = await authorize();
    send({ type: "busabase:buda-error", reason: "__proto__", message: "<script>unsafe</script>" });
    expect(screen.getByRole("alert").textContent).toBe(
      "Buda authorization was not completed. Try again.",
    );
  });

  it("recovers after manually closing the popup without inventing a successful connection", async () => {
    const { opened, create } = await authorize();
    Object.defineProperty(opened, "closed", { value: true });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Authorization window closed. Check your saved connections or try again.",
    );
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Open Buda" }).disabled).toBe(
      false,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("expires a pending popup and restores retry", async () => {
    const { opened, create } = await authorize();
    const now = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now + 600_001);
    await screen.findByRole("alert");
    expect(opened.close).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toBe(
      "Buda authorization expired or could not be verified. Try again.",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("cancels pending authorization on dialog close and unmount", async () => {
    const { opened, send, create, unmount } = await authorize();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opened.close).toHaveBeenCalledTimes(1);
    send({ type: "busabase:buda-connected", slug: "buda-agent-1" });
    expect(create).not.toHaveBeenCalled();
    unmount();
  });

  it("discards the old attempt when the workspace changes", async () => {
    const { opened, send, create, rerender, client, orpc, onBack, onConnected } = await authorize();
    rerender(
      <QueryClientProvider client={client}>
        <AgentsAddView orpc={orpc} onBack={onBack} onConnected={onConnected} spaceId="space-2" />
      </QueryClientProvider>,
    );
    expect(opened.close).toHaveBeenCalledTimes(1);
    send({ type: "busabase:buda-connected", slug: "buda-agent-1" });
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes an active popup on unmount and ignores its late success", async () => {
    const { opened, send, create, unmount } = await authorize();
    unmount();
    expect(opened.close).toHaveBeenCalledTimes(1);
    send({ type: "busabase:buda-connected", slug: "buda-agent-1" });
    expect(create).not.toHaveBeenCalled();
  });
});
