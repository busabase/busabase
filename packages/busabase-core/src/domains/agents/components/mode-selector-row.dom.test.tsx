// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgentSessionModeOptionVO } from "busabase-contract/domains/agents/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModeSelectorRow } from "./mode-selector-row";

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

const mode: AgentSessionModeOptionVO = {
  id: "vendor-policy",
  name: "Permission mode",
  source: "config",
  currentValue: "default",
  options: [
    { value: "default", name: "Default", description: "Ask before changes" },
    { value: "full", name: "Full access", description: "Run supported tools" },
  ],
};

describe("ModeSelectorRow", () => {
  afterEach(cleanup);

  it("uses advertised names and descriptions and waits for confirmation to change selection", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ModeSelectorRow modeOption={mode} modeLabel="Mode" disabled={false} onChange={onChange} />,
    );
    const trigger = screen.getByRole("button", { name: "Permission mode" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    expect(screen.getByText("Ask before changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Full access" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("full");
    expect(trigger.textContent).toContain("Default");
    rerender(
      <ModeSelectorRow
        modeOption={{ ...mode, currentValue: "full" }}
        modeLabel="Mode"
        disabled={false}
        onChange={onChange}
      />,
    );
    expect(trigger.textContent).toContain("Full access");
  });

  it("keeps the previous confirmed selection on rejection and shows the error", () => {
    render(
      <ModeSelectorRow
        modeOption={mode}
        modeLabel="Mode"
        disabled={false}
        error="Policy locked"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Permission mode" }).textContent).toContain(
      "Default",
    );
    expect(screen.getByRole("alert").textContent).toBe("Policy locked");
  });

  it("disables changes while another operation owns the session", () => {
    const onChange = vi.fn();
    render(<ModeSelectorRow modeOption={mode} modeLabel="Mode" disabled onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Permission mode" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses a localized legacy label without rewriting generic agent mode names", () => {
    render(
      <ModeSelectorRow
        modeOption={{
          ...mode,
          source: "legacy",
          currentValue: "plan",
          options: [{ value: "plan", name: "Planning" }],
        }}
        modeLabel="模式"
        disabled={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "模式" }).textContent).toContain("Planning");
    expect(screen.queryByText("Auto-review")).toBeNull();
  });
});
