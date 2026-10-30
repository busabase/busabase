// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { createKnownNodeCache } from "../helpers/known-node-cache";
import { registerSidePanelTab, type SidePanelTabProps } from "../side-panel-registry";
import { DEFAULT_SIDE_PANEL_WIDTH, useSidePanelStore } from "../store/side-panel-store";
import { SidePanel } from "./side-panel";
import { openAgentChatTab } from "./side-panel-sources";

vi.mock("./side-panel-add-tab", () => ({ SidePanelAddTab: () => null }));
vi.mock("./side-panel-empty-state", () => ({
  SidePanelEmptyState: ({ onOpenAgents }: { onOpenAgents: () => void }) => (
    <button onClick={onOpenAgents} type="button">
      Agents
    </button>
  ),
  SidePanelAgentPicker: () => <p>Connected agents</p>,
}));

const renderedSessions: { orpc: BusabaseQueryUtils; sessionId: string }[] = [];
const unmount = vi.fn();

function ChatProbe({ orpc, payload }: SidePanelTabProps) {
  const { sessionId } = payload as { sessionId: string };
  const [draft, setDraft] = useState("");
  renderedSessions.push({ orpc, sessionId });
  useEffect(() => () => unmount(sessionId), [sessionId]);
  return (
    <input aria-label="Draft" onChange={(event) => setDraft(event.target.value)} value={draft} />
  );
}

function panel(scopeKey: string, orpc: BusabaseQueryUtils) {
  return (
    <CoreI18nProvider locale="en">
      <SidePanel
        currentNode={null}
        nodeCache={createKnownNodeCache(scopeKey)}
        onNavigate={vi.fn()}
        onOpenSearch={vi.fn()}
        orpc={orpc}
        scopeKey={scopeKey}
      />
    </CoreI18nProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  useSidePanelStore.setState({
    scopeKey: null,
    isOpen: false,
    layout: "split",
    width: DEFAULT_SIDE_PANEL_WIDTH,
    activeTabId: null,
    tabs: [],
  });
  renderedSessions.length = 0;
  unmount.mockClear();
  registerSidePanelTab("agent-chat", ChatProbe);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("SidePanel workspace ownership", () => {
  it("preserves the chat and its unsent draft during same-space navigation and collapse", () => {
    const orpc = {} as BusabaseQueryUtils;
    const view = render(panel("space-a:user-a", orpc));
    act(() => openAgentChatTab("buda:research", "Research", { sessionId: "session-a" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Draft" }), {
      target: { value: "Unsent question" },
    });

    act(() => useSidePanelStore.getState().setOpen(false));
    view.rerender(panel("space-a:user-a", orpc));
    act(() => useSidePanelStore.getState().setOpen(true));

    expect((screen.getByRole("textbox", { name: "Draft" }) as HTMLInputElement).value).toBe(
      "Unsent question",
    );
    expect(unmount).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "never renders a previous space's session through the new API (collapsed: %s)",
    (collapsed) => {
      const orpcA = {} as BusabaseQueryUtils;
      const orpcB = {} as BusabaseQueryUtils;
      const view = render(panel("space-a:user-a", orpcA));
      act(() => openAgentChatTab("buda:research", "Research A", { sessionId: "session-a" }));
      fireEvent.change(screen.getByRole("textbox", { name: "Draft" }), {
        target: { value: "Private draft A" },
      });
      if (collapsed) act(() => useSidePanelStore.getState().setOpen(false));

      view.rerender(panel("space-b:user-a", orpcB));

      expect(renderedSessions.some((entry) => entry.orpc === orpcB)).toBe(false);
      expect(unmount).toHaveBeenCalledWith("session-a");
      expect(screen.queryByRole("tab", { name: /Research A/ })).toBeNull();
      expect(useSidePanelStore.getState().tabs).toEqual([]);
      expect(useSidePanelStore.getState().isOpen).toBe(!collapsed);

      act(() => openAgentChatTab("buda:research", "Research B", { sessionId: "session-b" }));
      expect((screen.getByRole("textbox", { name: "Draft" }) as HTMLInputElement).value).toBe("");
      expect(renderedSessions.at(-1)).toEqual({ orpc: orpcB, sessionId: "session-b" });
      expect(
        renderedSessions.some((entry) => entry.orpc === orpcB && entry.sessionId === "session-a"),
      ).toBe(false);
    },
  );

  it("retires a chat when the actor changes in the same space", () => {
    const orpc = {} as BusabaseQueryUtils;
    const view = render(panel("space-a:user-a", orpc));
    act(() => openAgentChatTab("buda:research", "Research", { sessionId: "session-a" }));

    view.rerender(panel("space-a:user-b", orpc));

    expect(screen.queryByRole("textbox", { name: "Draft" })).toBeNull();
    expect(unmount).toHaveBeenCalledWith("session-a");
    expect(useSidePanelStore.getState().tabs).toEqual([]);
  });

  it("returns to a fresh launcher after switching spaces from the Agent picker", () => {
    const orpc = {} as BusabaseQueryUtils;
    const view = render(panel("space-a:user-a", orpc));
    act(() => useSidePanelStore.getState().setOpen(true));
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(screen.getByText("Connected agents")).toBeTruthy();
    view.rerender(panel("space-a:user-a", orpc));
    expect(screen.getByText("Connected agents")).toBeTruthy();

    view.rerender(panel("space-b:user-a", orpc));

    expect(screen.queryByText("Connected agents")).toBeNull();
    expect(screen.getByRole("button", { name: "Agents" })).toBeTruthy();
  });
});
