// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AgentSessionReliabilityVO } from "busabase-contract/domains/agents/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionReliabilityStatus } from "./agent-session-reliability-status";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

describe("conversation status visibility", () => {
  afterEach(cleanup);

  it.each(["idle", "reserved", "running", "waiting", "terminal"] as const)(
    "keeps routine status text and the check action out of a connected, saved %s conversation",
    (execution) => {
      const { container } = render(
        <AgentSessionReliabilityStatus
          reliability={{ connection: "connected", execution, synchronization: "synced" }}
          updatesRecovering={false}
          onCheck={vi.fn()}
        />,
      );
      expect(container.childElementCount).toBe(0);
      expect(screen.queryByRole("button", { name: "Check status" })).toBeNull();
    },
  );

  it.each<{
    name: string;
    reliability: Partial<AgentSessionReliabilityVO>;
    updatesRecovering?: boolean;
    message: string;
  }>([
    { name: "connecting", reliability: { connection: "connecting" }, message: "Connecting" },
    { name: "disconnected", reliability: { connection: "disconnected" }, message: "Disconnected" },
    {
      name: "unknown execution",
      reliability: { execution: "unknown" },
      message: "Execution unknown",
    },
    {
      name: "recovering history",
      reliability: { synchronization: "recovering" },
      message: "Recovering",
    },
    {
      name: "interrupted history",
      reliability: { synchronization: "degraded" },
      message: "History sync interrupted",
    },
    {
      name: "incomplete history",
      reliability: { synchronization: "gap" },
      message: "History incomplete",
    },
    {
      name: "lost updates",
      reliability: {},
      updatesRecovering: true,
      message: "Reconnecting to conversation updates. The last saved state is shown below.",
    },
  ])("keeps status checking available for $name", ({ reliability, updatesRecovering, message }) => {
    const check = vi.fn();
    render(
      <AgentSessionReliabilityStatus
        reliability={{
          connection: "connected",
          execution: "idle",
          synchronization: "synced",
          ...reliability,
        }}
        updatesRecovering={updatesRecovering ?? false}
        onCheck={check}
      />,
    );
    expect(screen.getByText(message)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check status" }));
    expect(check).toHaveBeenCalledOnce();
  });

  it("keeps recovered history accessible after the live conversation reconnects", async () => {
    render(
      <AgentSessionReliabilityStatus
        reliability={{ connection: "connected", execution: "idle", synchronization: "synced" }}
        updatesRecovering={false}
        onCheck={vi.fn()}
        recoverySnapshot={{
          capturedAt: "2026-11-19T00:00:00Z",
          complete: true,
          truncated: false,
          updates: [],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Inspect recovered history" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});

describe("recovered conversation inspector", () => {
  afterEach(cleanup);

  it("shows meaningful recovered messages read-only without replacing the live history or resolving its gap", async () => {
    const check = vi.fn();
    render(
      <AgentSessionReliabilityStatus
        reliability={{ connection: "connected", execution: "unknown", synchronization: "gap" }}
        updatesRecovering={false}
        onCheck={check}
        recoverySnapshot={{
          capturedAt: "2026-11-03T00:00:00Z",
          complete: false,
          truncated: false,
          updates: [
            {
              sessionUpdate: "user_message_chunk",
              content: { type: "text", text: "A recovered question" },
            },
            {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "A recovered answer" },
            },
          ],
        }}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inspect recovered history" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("A recovered question")).toBeTruthy();
    expect(within(dialog).getByText("A recovered answer")).toBeTruthy();
    expect(within(dialog).getByText(/Read-only history recovered from the agent/)).toBeTruthy();
    expect(within(dialog).getByText(/Only part of the history is available/)).toBeTruthy();
    expect(
      within(screen.getByTestId("agent-session-reliability")).getByText("History incomplete"),
    ).toBeTruthy();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).queryByText("sessionUpdate")).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });
});
