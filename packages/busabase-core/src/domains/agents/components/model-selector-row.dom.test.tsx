// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSelectorRow } from "./model-selector-row";

/**
 * Radix `Select` renders its listbox in a portal only once opened, so
 * `renderToStaticMarkup` can't see the options — this needs a real DOM, the
 * same reason `agent-skill-button.dom.test.tsx` exists for its own Radix tabs.
 */

const MODEL_OPTION = {
  id: "model",
  name: "Model",
  currentValue: "auto",
  options: [
    { value: "auto", name: "Auto" },
    { value: "fast", name: "Fast" },
  ],
};

describe("ModelSelectorRow", () => {
  afterEach(cleanup);

  it("shows the current model as the trigger's value", () => {
    render(<ModelSelectorRow modelOption={MODEL_OPTION} disabled={false} onChange={() => {}} />);
    expect(screen.getByRole("combobox").textContent).toContain("Auto");
  });

  it("offers every advertised option and reports the picked value", () => {
    const onChange = vi.fn();
    render(<ModelSelectorRow modelOption={MODEL_OPTION} disabled={false} onChange={onChange} />);

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Fast" }));

    expect(onChange).toHaveBeenCalledWith("fast");
  });

  it("disables the picker while a change is pending", () => {
    render(<ModelSelectorRow modelOption={MODEL_OPTION} disabled onChange={() => {}} />);
    expect(screen.getByRole("combobox").getAttribute("data-disabled")).not.toBeNull();
  });

  it("shows a model change error next to the picker", () => {
    render(
      <ModelSelectorRow
        modelOption={MODEL_OPTION}
        disabled={false}
        error="Could not change model."
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Could not change model.");
  });
});
