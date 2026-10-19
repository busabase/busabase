// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FieldHelp, FieldHelpPopover } from "./field-help";

afterEach(cleanup);

describe("field filling guidance", () => {
  it("renders plain text, preserves line breaks and expands long instructions", () => {
    const description = `First line\n${"Guidance ".repeat(40)}<script>unsafe()</script>`;
    const view = render(<FieldHelp help={{ description, example: "<b>Example</b>" }} />);
    expect(view.container.querySelector("script")).toBeNull();
    expect(view.container.querySelector("b")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(view.container.textContent).toContain(description);
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("opens by click without requiring hover and can be dismissed with Escape", () => {
    render(
      <FieldHelpPopover fieldId="delivery" name="Delivery" help={{ description: "Actual date" }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View instructions for Delivery" }));
    expect(screen.getByText("Actual date")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Actual date")).toBeNull();
  });

  it("shows no icon or block for empty guidance", () => {
    const view = render(
      <>
        <FieldHelp help={{ description: " " }} />
        <FieldHelpPopover fieldId="empty" name="Empty" />
      </>,
    );
    expect(view.container.textContent).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
