// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BaseFieldVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { TABLE_CELL_PREVIEW_MAX_CHARS } from "../helpers/table-cell-preview";
import { InlineEditableCellValue } from "./base-table-inline-cell";
import { FormulaValue } from "./formula-value";

vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

const field = (type: BaseFieldVO["type"]): BaseFieldVO => ({
  id: "field",
  baseId: "base",
  slug: "value",
  name: "Value",
  type,
  required: false,
  position: 0,
  options: {},
});

afterEach(cleanup);

describe("grid preview bounds", () => {
  it("bounds a formula string before formatting and keeps full-record display opt-in", () => {
    const value = `first line\n${"x".repeat(100000)}tail-marker`;
    const rendered = render(
      <CoreI18nProvider locale="en">
        <FormulaValue
          field={field("formula")}
          value={value}
          maxChars={TABLE_CELL_PREVIEW_MAX_CHARS}
        />
      </CoreI18nProvider>,
    );
    const preview = screen.getByTestId("formula-cell-value");
    expect(preview.textContent?.length).toBeLessThanOrEqual(TABLE_CELL_PREVIEW_MAX_CHARS + 1);
    expect(preview.getAttribute("title")?.length).toBeLessThanOrEqual(TABLE_CELL_PREVIEW_MAX_CHARS);
    expect(preview.getAttribute("data-formula-preview-bounded")).toBe("true");
    expect(rendered.container.innerHTML).not.toContain("tail-marker");
    rendered.rerender(
      <CoreI18nProvider locale="en">
        <FormulaValue field={field("formula")} value="complete full-record result" />
      </CoreI18nProvider>,
    );
    expect(screen.getByTestId("formula-cell-value").textContent).toBe(
      "complete full-record result",
    );
  });

  it.each(["url", "email", "phone"] as const)(
    "opens the record for an oversized editable %s instead of putting the value in the DOM",
    (type) => {
      const onOpenRecord = vi.fn();
      const value = `https://example.com/${"x".repeat(100000)}tail-marker`;
      const { container } = render(
        <CoreI18nProvider locale="en">
          <InlineEditableCellValue
            active
            field={field(type)}
            index={1}
            onToggle={vi.fn()}
            value={value}
            rowHeight={144}
            recordHref="/base/tasks/record?space=local"
            onOpenRecord={onOpenRecord}
          />
        </CoreI18nProvider>,
      );
      const link = screen.getByRole("link", { name: "View full content" });
      expect(link.getAttribute("href")).toBe("/base/tasks/record?space=local");
      expect(container.innerHTML).not.toContain("tail-marker");
      expect(fireEvent.click(link)).toBe(false);
      expect(onOpenRecord).toHaveBeenCalledOnce();
    },
  );

  it("preserves a long signed URL within the supported limit and bounds only its preview", () => {
    const value = `https://example.com/file?signature=${"s".repeat(3000)}`;
    render(
      <CoreI18nProvider locale="en">
        <InlineEditableCellValue
          active
          field={field("url")}
          index={1}
          onToggle={vi.fn()}
          value={value}
          rowHeight={96}
          recordHref="/base/tasks/record"
        />
      </CoreI18nProvider>,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(value);
    expect(link.getAttribute("title")?.length).toBe(TABLE_CELL_PREVIEW_MAX_CHARS);
    expect(link.textContent?.length).toBe(TABLE_CELL_PREVIEW_MAX_CHARS);
  });
});
