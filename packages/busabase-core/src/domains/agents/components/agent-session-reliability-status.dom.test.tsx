// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
