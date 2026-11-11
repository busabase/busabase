// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { BaseFieldVO, LookupComputedVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";

vi.mock("wouter", () => ({ useSearch: () => "" }));
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

const { LookupFieldValue } = await import("./field-preview");
const field: BaseFieldVO = {
  id: "lookup",
  baseId: "reviews",
  slug: "result",
  name: "Source result",
  type: "lookup",
  position: 1,
  required: false,
  options: {
    lookup: { relationFieldSlug: "related", targetFieldSlug: "content", rollup: "values" },
  },
};
const target = (type: BaseFieldVO["type"], options: BaseFieldVO["options"] = {}): BaseFieldVO => ({
  ...field,
  id: "source-field",
  baseId: "sources",
  slug: "content",
  name: "Source content",
  type,
  options,
});
const computed = (
  targetField: BaseFieldVO,
  value: unknown[],
  sources: LookupComputedVO["sources"] = [],
): LookupComputedVO => ({
  status: "ready",
  targetField,
  value,
  sources,
  sourceBaseId: "sources",
  sourceBaseSlug: "sources",
  dependencyVersion: "v1",
});
const show = (result: LookupComputedVO, rowHeight = 48) =>
  render(
    <CoreI18nProvider locale="en">
      <LookupFieldValue
        computed={result}
        field={field}
        fieldUsers={{
          user1: { id: "user1", name: "Alice", email: null, image: null, role: null },
        }}
        presentation="grid"
        rowHeight={rowHeight}
        value={result.value}
      />
    </CoreI18nProvider>,
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("height-aware typed lookup previews", () => {
  it.each([
    [32, 1],
    [48, 2],
    [96, 4],
    [144, 6],
  ])("bounds a multiline lookup at %ipx and retains the complete source", (height, lines) => {
    const text = "First line\nSecond line\n第三行内容\nFourth line\nFifth line\nSixth line";
    show(
      computed(
        target("longtext"),
        [text],
        [{ recordId: "rec1", title: "Original note", value: text, headCommitId: "commit1" }],
      ),
      height,
    );
    const cell = screen.getByTestId("lookup-field-result");
    const preview = cell.querySelector("[data-grid-cell-text]") as HTMLElement;
    expect(preview.dataset.gridTextLines).toBe(String(lines));
    expect(preview.textContent).toContain("First line\nSecond line");
    expect(preview.style.maxHeight).toBe(`${lines * 20}px`);
    expect(cell.style.maxHeight).toBe(`${height - 8}px`);
    fireEvent.click(screen.getByTestId("lookup-sources-result"));
    expect(screen.getByTestId("lookup-source-dialog").textContent).toContain("Sixth line");
  });

  it("does not mount rich-text or HTML frames inside the grid", () => {
    show(computed(target("html"), ['<p>Readable content</p><script>alert("never")</script>']), 96);
    const cell = screen.getByTestId("lookup-field-result");
    expect(cell.querySelector("iframe, pre, script")).toBeNull();
    expect(cell.textContent).toContain("Readable content");
  });

  it("keeps formatted numbers, false, member names, and choice labels", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    const amount = show(
      computed(target("number", { number: { format: "currency", currency: "EUR" } }), [12]),
    );
    expect(screen.getByTestId("lookup-field-result").textContent).toContain("€12");
    amount.unmount();
    const boolean = show(computed(target("checkbox"), [false]), 32);
    expect(screen.getByTestId("lookup-field-result").textContent).toContain("No");
    boolean.unmount();
    const member = show(computed(target("member"), ["user1"]), 96);
    expect(screen.getByTestId("lookup-field-result").textContent).toContain("Alice");
    member.unmount();
    show(
      computed(target("select", { choices: [{ id: "passed", name: "Passed", color: "green" }] }), [
        "passed",
      ]),
      96,
    );
    expect(screen.getByText("Passed").className).toContain("green");
  });

  it("shows recoverable collection overflow and retains original link destinations", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(110);
    show(computed(target("url"), ["https://example.com/first", "https://example.com/last"]), 32);
    const cell = screen.getByTestId("lookup-field-result");
    const overflow = cell.querySelector("[data-lookup-overflow]") as HTMLElement;
    expect(overflow).not.toBeNull();
    fireEvent.click(overflow);
    const dialog = screen.getByTestId("lookup-source-dialog");
    expect(
      within(dialog).getByRole("link", { name: "https://example.com/last" }).getAttribute("href"),
    ).toBe("https://example.com/last");
  });

  it("passes the row height to attachment and drive targets", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
    const files = [
      {
        id: "file1",
        fileName: "map.png",
        mimeType: "image/png",
        url: "https://example.com/map.png",
        size: 100,
      },
    ];
    for (const type of ["attachment", "drive"] as const) {
      const result = show(computed(target(type), files), 144);
      const preview = screen
        .getByTestId("lookup-field-result")
        .querySelector("[data-attachment-preview]") as HTMLElement;
      expect(preview.dataset.attachmentThumbnailSize).toBe("128");
      result.unmount();
    }
  });
});
