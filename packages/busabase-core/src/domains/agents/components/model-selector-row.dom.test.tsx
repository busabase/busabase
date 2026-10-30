// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSelectorRow } from "./model-selector-row";

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

const MODEL_OPTION = {
  id: "model",
  name: "Model",
  currentValue: "auto",
  options: [
    { value: "auto", name: "Auto" },
    { value: "fast", name: "Fast" },
  ],
};
const THINKING_OPTION = {
  id: "reasoning_effort",
  name: "Effort",
  currentValue: "medium",
  options: [
    { value: "medium", name: "Medium" },
    { value: "high", name: "High" },
  ],
};

function ControlledModelSelector({
  onChange,
  modelOption = MODEL_OPTION,
}: {
  onChange: (value: string) => void;
  modelOption?: typeof MODEL_OPTION;
}) {
  const [currentValue, setCurrentValue] = useState(modelOption.currentValue);
  return (
    <ModelSelectorRow
      modelOption={{ ...modelOption, currentValue }}
      disabled={false}
      onChange={(value) => {
        setCurrentValue(value);
        onChange(value);
      }}
    />
  );
}

function openModelMenu() {
  const trigger = screen.getByRole("button", { name: "Model" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  return trigger;
}

function openThinkingSubmenu(modelName = "Auto") {
  const item = screen.getByRole("menuitem", { name: new RegExp(`^${modelName}, Thinking Level:`) });
  fireEvent.keyDown(item, { key: "ArrowRight" });
  return item;
}

describe("ModelSelectorRow", () => {
  afterEach(cleanup);

  it("shows the current model in one menu trigger", () => {
    render(<ModelSelectorRow modelOption={MODEL_OPTION} disabled={false} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Model" }).textContent).toContain("Auto");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("offers every advertised model and reports an explicit selection", () => {
    const onChange = vi.fn();
    render(<ModelSelectorRow modelOption={MODEL_OPTION} disabled={false} onChange={onChange} />);
    openModelMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Fast" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("fast");
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("does not mutate on hover or invent a thinking submenu for unselected models", () => {
    const onChange = vi.fn();
    render(
      <ModelSelectorRow
        modelOption={MODEL_OPTION}
        thinkingOption={THINKING_OPTION}
        thinkingLabel="Thinking Level"
        disabled={false}
        onChange={onChange}
        onThinkingChange={() => {}}
      />,
    );
    openModelMenu();
    const fast = screen.getByRole("menuitemradio", { name: "Fast" });
    fireEvent.pointerMove(fast, { pointerType: "mouse" });
    expect(onChange).not.toHaveBeenCalled();
    expect(fast.getAttribute("aria-haspopup")).toBeNull();
    expect(screen.queryByRole("menuitemradio", { name: "High" })).toBeNull();
  });

  it("reveals each model's advertised levels on hover without changing either selector", async () => {
    const onChange = vi.fn();
    const onThinkingChange = vi.fn();
    const modelOption = {
      ...MODEL_OPTION,
      options: [
        MODEL_OPTION.options[0]!,
        { ...MODEL_OPTION.options[1]!, thinking: THINKING_OPTION },
      ],
    };
    render(
      <ModelSelectorRow
        modelOption={modelOption}
        thinkingLabel="Thinking Level"
        disabled={false}
        onChange={onChange}
        onThinkingChange={onThinkingChange}
      />,
    );
    openModelMenu();
    const fast = screen.getByRole("menuitem", { name: /^Fast, Thinking Level: Medium/ });
    // jsdom lacks PointerEvent; retain the native mouse fields plus pointerType.
    fireEvent(
      fast,
      Object.assign(new MouseEvent("pointermove", { bubbles: true }), { pointerType: "mouse" }),
    );
    await screen.findByRole("menuitemradio", { name: "High" });
    expect(onChange).not.toHaveBeenCalled();
    expect(onThinkingChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "High" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("fast", "high");
    expect(onThinkingChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("uses the current model's confirmed levels instead of its advertised defaults", () => {
    const onChange = vi.fn();
    const onThinkingChange = vi.fn();
    render(
      <ModelSelectorRow
        modelOption={{
          ...MODEL_OPTION,
          options: [
            {
              value: "auto",
              name: "Auto",
              thinking: {
                ...THINKING_OPTION,
                currentValue: "extreme",
                options: [{ value: "extreme", name: "Extreme" }],
              },
            },
          ],
        }}
        thinkingOption={THINKING_OPTION}
        thinkingLabel="Thinking Level"
        disabled={false}
        onChange={onChange}
        onThinkingChange={onThinkingChange}
      />,
    );
    openModelMenu();
    openThinkingSubmenu();
    expect(screen.queryByRole("menuitemradio", { name: "Extreme" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "High" }));
    expect(onThinkingChange).toHaveBeenCalledExactlyOnceWith("high");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables the trigger and open menu actions while a change is pending", () => {
    const props = { modelOption: MODEL_OPTION, onChange: vi.fn() };
    const view = render(<ModelSelectorRow {...props} disabled={false} />);
    const trigger = openModelMenu();
    view.rerender(<ModelSelectorRow {...props} disabled />);
    expect(trigger.getAttribute("disabled")).not.toBeNull();
    expect(
      screen.getByRole("menuitemradio", { name: "Fast" }).getAttribute("data-disabled"),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Fast" }));
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("shows an error and retains the confirmed model after a failed change", () => {
    const props = { modelOption: MODEL_OPTION, disabled: false, onChange: vi.fn() };
    const view = render(<ModelSelectorRow {...props} />);
    openModelMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Fast" }));
    view.rerender(<ModelSelectorRow {...props} error="Could not change model." />);
    expect(screen.getByRole("alert").textContent).toContain("Could not change model.");
    expect(screen.getByRole("button", { name: "Model" }).textContent).toContain("Auto");
    openModelMenu();
    expect(screen.getByRole("menuitemradio", { name: "Auto" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("keeps the confirmed model when the prompt form resets after submit", () => {
    const onChange = vi.fn();
    render(
      <form data-testid="prompt-form">
        <ControlledModelSelector onChange={onChange} />
      </form>,
    );
    openModelMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Fast" }));
    expect(screen.getByRole("button", { name: "Model" }).textContent).toContain("Fast");
    fireEvent.reset(screen.getByTestId("prompt-form"));
    expect(screen.getByRole("button", { name: "Model" }).textContent).toContain("Fast");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("nests only advertised levels under the selected model and reports the picked value", () => {
    const onThinkingChange = vi.fn();
    render(
      <ModelSelectorRow
        modelOption={MODEL_OPTION}
        thinkingOption={THINKING_OPTION}
        thinkingLabel="Thinking Level"
        disabled={false}
        onChange={() => {}}
        onThinkingChange={onThinkingChange}
      />,
    );
    expect(screen.getByRole("button", { name: "Model" }).textContent).toContain("Auto· Medium");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    openModelMenu();
    expect(screen.getByText("Thinking Level: Medium")).toBeTruthy();
    openThinkingSubmenu();
    expect(screen.getByRole("menuitemradio", { name: "Medium" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.queryByRole("menuitemradio", { name: "Low" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "High" }));
    expect(onThinkingChange).toHaveBeenCalledExactlyOnceWith("high");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps the model menu open and opens levels only after an authoritative new model snapshot", async () => {
    const props = { thinkingLabel: "Thinking Level", onChange: vi.fn(), onThinkingChange: vi.fn() };
    const view = render(
      <ModelSelectorRow {...props} modelOption={MODEL_OPTION} disabled={false} />,
    );
    openModelMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Fast" }));
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith("fast");
    view.rerender(<ModelSelectorRow {...props} modelOption={MODEL_OPTION} disabled />);
    expect(screen.queryByRole("menuitemradio", { name: "High" })).toBeNull();
    view.rerender(
      <ModelSelectorRow
        {...props}
        modelOption={{ ...MODEL_OPTION, currentValue: "fast" }}
        thinkingOption={THINKING_OPTION}
        disabled={false}
      />,
    );
    await screen.findByRole("menuitemradio", { name: "High" });
    expect(screen.getByRole("menuitem", { name: /^Fast, Thinking Level: Medium/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "High" }));
    expect(props.onThinkingChange).toHaveBeenCalledExactlyOnceWith("high");
  });

  it("closes after confirming a model that does not offer thinking choices", async () => {
    const props = { onChange: vi.fn(), onThinkingChange: vi.fn() };
    const view = render(
      <ModelSelectorRow {...props} modelOption={MODEL_OPTION} disabled={false} />,
    );
    openModelMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Fast" }));
    view.rerender(
      <ModelSelectorRow
        {...props}
        modelOption={{ ...MODEL_OPTION, currentValue: "fast" }}
        disabled={false}
      />,
    );
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("does not reopen a dismissed menu when a model response arrives", async () => {
    const props = { thinkingLabel: "Thinking Level", onChange: vi.fn(), onThinkingChange: vi.fn() };
    const view = render(
      <ModelSelectorRow {...props} modelOption={MODEL_OPTION} disabled={false} />,
    );
    openModelMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Fast" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    view.rerender(
      <ModelSelectorRow
        {...props}
        modelOption={{ ...MODEL_OPTION, currentValue: "fast" }}
        thinkingOption={THINKING_OPTION}
        disabled={false}
      />,
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("removes the submenu when ACP revokes thinking choices", () => {
    const props = {
      modelOption: MODEL_OPTION,
      thinkingLabel: "Thinking Level",
      disabled: false,
      onChange: () => {},
      onThinkingChange: () => {},
    };
    const view = render(<ModelSelectorRow {...props} thinkingOption={THINKING_OPTION} />);
    openModelMenu();
    openThinkingSubmenu();
    expect(screen.getByRole("menuitemradio", { name: "High" })).toBeTruthy();
    view.rerender(<ModelSelectorRow {...props} thinkingOption={null} />);
    expect(screen.queryByRole("menuitemradio", { name: "High" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Thinking Level/ })).toBeNull();
    view.rerender(<ModelSelectorRow {...props} thinkingOption={THINKING_OPTION} />);
    expect(screen.getByRole("menuitem", { name: /Thinking Level/ })).toBeTruthy();
    expect(screen.queryByRole("menuitemradio", { name: "High" })).toBeNull();
  });

  it("supports a thinking-only agent in one menu", () => {
    render(
      <ModelSelectorRow
        modelOption={null}
        thinkingOption={THINKING_OPTION}
        thinkingLabel="Thinking Level"
        disabled={false}
        onChange={() => {}}
        onThinkingChange={() => {}}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Thinking Level" });
    expect(trigger.textContent).toContain("Medium");
    expect(trigger.querySelector("svg.lucide-cpu")).not.toBeNull();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("menuitemradio", { name: "High" })).toBeTruthy();
  });

  it.each([
    { value: "anthropic/claude-haiku-4-5", name: "Fast", selector: 'path[fill="#D97757"]' },
    { value: "openai:gpt-6-luna", name: "Balanced", selector: 'svg[fill="currentColor"]' },
    { value: "deepseek-v4-flash", name: "Quick", selector: 'path[fill="#4D6BFE"]' },
    { value: "opaque", name: "Claude Haiku 4.5 · 1x", selector: 'path[fill="#D97757"]' },
    { value: "custom", name: "My Claude helper", selector: "svg.lucide-cpu" },
    { value: "custom", name: "Geminiature", selector: "svg.lucide-cpu" },
  ])("resolves the advertised model without branding unrelated names: $value / $name", (option) => {
    render(
      <ModelSelectorRow
        modelOption={{ ...MODEL_OPTION, currentValue: option.value, options: [option] }}
        disabled={false}
        onChange={() => {}}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Model" });
    expect(trigger.querySelector(option.selector)).not.toBeNull();
    openModelMenu();
    expect(
      screen.getByRole("menuitemradio", { name: option.name }).querySelector(option.selector),
    ).not.toBeNull();
  });

  it("replaces the current logo once when choosing a different provider", () => {
    const modelOption = {
      ...MODEL_OPTION,
      currentValue: "claude-haiku-4-5",
      options: [
        { value: "claude-haiku-4-5", name: "Claude Haiku 4.5 · 1x" },
        { value: "gemini-4-argon", name: "Gemini 4 Argon · 1x" },
      ],
    };
    const onChange = vi.fn();
    render(<ControlledModelSelector modelOption={modelOption} onChange={onChange} />);
    expect(
      screen.getByRole("button", { name: "Model" }).querySelector('path[fill="#D97757"]'),
    ).not.toBeNull();
    openModelMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Gemini 4 Argon · 1x" }));

    const trigger = screen.getByRole("button", { name: "Model" });
    expect(trigger.textContent).toBe("Gemini 4 Argon · 1x");
    expect(trigger.querySelector('path[fill="#D97757"]')).toBeNull();
    expect(trigger.querySelectorAll('path[fill="#3186FF"]')).toHaveLength(1);
    expect(trigger.querySelectorAll("svg")).toHaveLength(2); // Provider logo and select chevron.
    expect(onChange).toHaveBeenCalledWith("gemini-4-argon");
  });

  it("keeps Gemini gradients independent across the trigger and multiple options", () => {
    render(
      <ModelSelectorRow
        modelOption={{
          ...MODEL_OPTION,
          currentValue: "gemini-4-argon",
          options: [
            { value: "gemini-4-argon", name: "Gemini 4 Argon" },
            { value: "google/gemini-3-flash", name: "Gemini 3 Flash" },
          ],
        }}
        disabled={false}
        onChange={() => {}}
      />,
    );
    openModelMenu();
    const gradients = [...document.querySelectorAll("linearGradient")];
    expect(gradients).toHaveLength(9);
    expect(new Set(gradients.map((gradient) => gradient.id)).size).toBe(9);
    for (const path of document.querySelectorAll('path[fill^="url(#"]')) {
      const id = path.getAttribute("fill")?.slice(5, -1);
      expect(document.getElementById(id ?? "")).not.toBeNull();
    }
  });

  it("shows the current provider in the thinking submenu trigger without duplicating it on levels", () => {
    render(
      <ModelSelectorRow
        modelOption={{
          ...MODEL_OPTION,
          currentValue: "claude-haiku-4-5",
          options: [{ value: "claude-haiku-4-5", name: "Claude Haiku 4.5" }],
        }}
        thinkingOption={THINKING_OPTION}
        thinkingLabel="Thinking Level"
        disabled={false}
        onChange={() => {}}
        onThinkingChange={() => {}}
      />,
    );
    openModelMenu();
    const current = openThinkingSubmenu("Claude Haiku 4.5");
    expect(current.querySelectorAll('path[fill="#D97757"]')).toHaveLength(1);
    expect(screen.getByRole("menuitemradio", { name: "High" }).querySelector("svg")).toBeNull();
  });

  it("keeps a missing advertised selection usable and falls back to its current value", () => {
    render(
      <ModelSelectorRow
        modelOption={{ ...MODEL_OPTION, currentValue: "anthropic/claude-new" }}
        disabled={false}
        onChange={() => {}}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Model" });
    expect(trigger.textContent).toContain("anthropic/claude-new");
    expect(trigger.querySelector('path[fill="#D97757"]')).not.toBeNull();
    openModelMenu();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
  });
});
