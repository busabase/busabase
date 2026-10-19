// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FormBoundFieldVO, FormFieldBindingVO } from "busabase-contract/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeneratedFormField } from "./generated-form-field";

afterEach(cleanup);

const field: FormBoundFieldVO = {
  slug: "delivery",
  name: "Delivery",
  type: "text",
  choices: [],
  help: {
    description: "Actual acceptance date; leave empty until accepted.",
    example: "2026-10-14",
  },
};
const binding: FormFieldBindingVO = { fieldSlug: "delivery", inputName: "delivery" };

describe("generated form filling guidance", () => {
  it("inherits instructions, keeps them visible after entering a value, and never writes the example", () => {
    const onChange = vi.fn();
    const props = { binding, field, label: "Delivery", onChange };
    const view = render(<GeneratedFormField {...props} value="" />);
    const input = screen.getByLabelText("Delivery") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-describedby")).toBe("form-field-delivery-help");
    fireEvent.change(input, { target: { value: "My delivery" } });
    expect(onChange).toHaveBeenCalledWith("My delivery");
    view.rerender(<GeneratedFormField {...props} value="My delivery" />);
    expect(screen.getByText(field.help?.description ?? "")).toBeTruthy();
    expect(screen.getByText(/2026-10-14/)).toBeTruthy();
  });

  it("uses a form-specific description and preserves the field example", () => {
    render(
      <GeneratedFormField
        binding={{ ...binding, help: "Confirm this month's delivery." }}
        field={field}
        label="Delivery"
        onChange={vi.fn()}
        value=""
      />,
    );
    expect(screen.getByText("Confirm this month's delivery.")).toBeTruthy();
    expect(screen.queryByText(field.help?.description ?? "")).toBeNull();
    expect(screen.getByText(/2026-10-14/)).toBeTruthy();
  });

  it("supports intentional empty overrides and omits empty help regions", () => {
    render(
      <GeneratedFormField
        binding={{ ...binding, help: "" }}
        field={{ ...field, help: { description: "Inherited" } }}
        label="Delivery"
        onChange={vi.fn()}
        value="Existing"
      />,
    );
    expect(screen.queryByText("Inherited")).toBeNull();
    expect(screen.getByLabelText("Delivery").hasAttribute("aria-describedby")).toBe(false);
  });

  it("associates date guidance with the accessible date-picker trigger", () => {
    render(
      <GeneratedFormField
        binding={binding}
        field={{ ...field, type: "date" }}
        label="Delivery"
        onChange={vi.fn()}
        value=""
      />,
    );
    expect(screen.getByRole("button", { name: "Delivery" }).getAttribute("aria-describedby")).toBe(
      "form-field-delivery-help",
    );
  });
});
