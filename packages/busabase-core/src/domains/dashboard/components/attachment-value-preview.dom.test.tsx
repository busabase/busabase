// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { AttachmentValuePreview } from "./attachment-value-preview";

const file = (id: string, mimeType = "image/png") => ({
  id,
  url: `https://example.com/${id}`,
  fileName: `${id}.${mimeType === "image/png" ? "png" : "pdf"}`,
  mimeType,
  size: 100,
});

function show(value: unknown, compact = true) {
  return render(
    <CoreI18nProvider locale="en">
      <AttachmentValuePreview compact={compact} value={value} />
    </CoreI18nProvider>,
  );
}

afterEach(cleanup);

describe("attachment field previews", () => {
  it("keeps compact grid thumbnails labelled without rendering their file text", () => {
    const bounds = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(220);
    try {
      const result = render(
        <CoreI18nProvider locale="en">
          <AttachmentValuePreview
            presentation="grid"
            rowHeight={144}
            thumbnailOnly
            value={[file("contract", "application/pdf")]}
          />
        </CoreI18nProvider>,
      );
      const grid = result.container.querySelector("[data-attachment-preview]") as HTMLElement;
      expect(within(grid).getByRole("link", { name: "contract.pdf" })).toBeTruthy();
      expect(within(grid).queryByText("contract.pdf")).toBeNull();
      expect(grid.querySelector("[data-attachment-extension]")).toBeNull();
    } finally {
      bounds.mockRestore();
    }
  });

  it("recomputes a single-line grid prefix and recovers focus if resize removes the opener", async () => {
    let width = 138;
    let resize = () => {};
    const bounds = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockImplementation(() => width);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: (entries: { contentRect: { width: number } }[]) => void) {
          resize = () => callback([{ contentRect: { width } }]);
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      const result = render(
        <CoreI18nProvider locale="en">
          <AttachmentValuePreview
            presentation="grid"
            value={[file("one"), file("two", "application/pdf"), file("three")]}
          />
        </CoreI18nProvider>,
      );
      const grid = result.container.querySelector("[data-attachment-preview]") as HTMLElement;
      expect(grid.dataset.attachmentVisibleCount).toBe("3");
      width = 137;
      act(() => resize());
      expect(grid.dataset.attachmentVisibleCount).toBe("1");
      expect(within(grid).getByText("+2")).toBeTruthy();
      fireEvent.click(within(grid).getByRole("link", { name: "one.png" }));
      width = 30;
      act(() => resize());
      expect(grid.dataset.attachmentVisibleCount).toBe("0");
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
      await waitFor(() =>
        expect(document.activeElement).toBe(
          within(grid).getByRole("button", { name: "Expand: File preview" }),
        ),
      );
      expect(within(grid).getByText("+3")).toBeTruthy();
    } finally {
      bounds.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it.each([
    [30, 2],
    [64, 100],
  ])("combines count and expand at %ipx for %i files", (width, count) => {
    const bounds = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
    try {
      const result = render(
        <CoreI18nProvider locale="en">
          <AttachmentValuePreview
            presentation="grid"
            value={Array.from({ length: count ?? 0 }, (_, index) => file(String(index)))}
          />
        </CoreI18nProvider>,
      );
      const grid = result.container.querySelector("[data-attachment-preview]") as HTMLElement;
      const button = within(grid).getByRole("button", { name: "Expand: File preview" });
      expect(within(grid).getAllByRole("button")).toHaveLength(1);
      expect(button.textContent).toBe(`+${count}`);
      expect(Number.parseInt(button.style.width, 10)).toBeLessThanOrEqual(width ?? 0);
      fireEvent.click(button);
      expect(
        screen
          .getByTestId("attachment-cell-expanded")
          .querySelectorAll("[data-attachment-cell-item]"),
      ).toHaveLength(count ?? 0);
    } finally {
      bounds.mockRestore();
    }
  });

  it("expands by keyboard, selects the last file, and restores the cell expand button", async () => {
    const bounds = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(220);
    try {
      const files = Array.from({ length: 26 }, (_, index) =>
        file(String(index), "application/pdf"),
      );
      const result = render(
        <CoreI18nProvider locale="en">
          <AttachmentValuePreview presentation="grid" value={files} />
        </CoreI18nProvider>,
      );
      const grid = result.container.querySelector("[data-attachment-preview]") as HTMLElement;
      expect(grid.dataset.attachmentVisibleCount).toBe("4");
      expect(grid.tabIndex).toBe(0);
      grid.focus();
      fireEvent.keyDown(grid, { key: " ", shiftKey: true });
      const expanded = screen.getByTestId("attachment-cell-expanded");
      expect(expanded.querySelectorAll("[data-attachment-cell-item]")).toHaveLength(26);
      fireEvent.click(within(expanded).getByRole("button", { name: "25.pdf" }));
      expect(screen.queryByTestId("attachment-cell-expanded")).toBeNull();
      const dialog = screen.getByTestId("attachment-preview-dialog");
      expect(within(dialog).getByRole("heading", { name: "25.pdf" })).toBeTruthy();
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      await waitFor(() =>
        expect(document.activeElement).toBe(
          within(grid).getByRole("button", { name: "Expand: File preview" }),
        ),
      );
      fireEvent.click(within(grid).getByRole("button", { name: "Expand: File preview" }));
      expect(screen.getByTestId("attachment-cell-expanded")).toBeTruthy();
    } finally {
      bounds.mockRestore();
    }
  });

  it("keeps duplicate asset occurrences separately selectable and restores overflow focus", async () => {
    const duplicated = { ...file("same"), assetId: "ast_same" };
    show([duplicated, file("middle"), duplicated, duplicated]);
    const opener = screen.getByText("+1");
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    const choices = within(dialog).getAllByRole("button", { name: "same.png" });
    expect(choices).toHaveLength(3);
    expect(choices.map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "true",
    ]);
    fireEvent.click(choices[1] as HTMLElement);
    expect(choices.map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(
      within(dialog).getByRole("link", { name: "Download file" }).getAttribute("href"),
    ).toContain("/api/assets/ast_same/raw");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("preserves modified browser clicks without opening a dialog", () => {
    show([file("photo")]);
    const link = screen.getByRole("link", { name: "photo.png" });
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("falls back to the current attachment when an open selection is removed", async () => {
    const result = show([file("first"), file("removed")], false);
    fireEvent.click(screen.getByRole("link", { name: "removed.png" }));
    result.rerender(
      <CoreI18nProvider locale="en">
        <AttachmentValuePreview value={[file("first")]} />
      </CoreI18nProvider>,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "first.png" })).toBeTruthy();
    expect(within(dialog).queryByRole("img", { name: "removed.png" })).toBeNull();
    expect(
      (await within(dialog).findByRole("img", { name: "first.png" })).getAttribute("src"),
    ).toBe("https://example.com/first");
  });

  it("keeps failed grid files identifiable and retries without opening the preview", () => {
    const bounds = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(160);
    try {
      render(
        <CoreI18nProvider locale="en">
          <AttachmentValuePreview presentation="grid" value={[file("failed")]} />
        </CoreI18nProvider>,
      );
      fireEvent.error(screen.getByRole("img", { name: "failed.png" }));
      const link = screen.getByRole("link", { name: "failed.png" });
      expect(link.getAttribute("href")).toBe("https://example.com/failed");
      fireEvent.click(screen.getByRole("button", { name: "Retry: failed.png" }));
      expect(screen.getByRole("img", { name: "failed.png" })).toBeTruthy();
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      bounds.mockRestore();
    }
  });
  it("keeps mixed files in the user's order and makes overflow accessible", () => {
    const files = [file("report", "application/pdf"), file("photo"), file("second"), file("last")];
    const { container } = show(files);
    const inline = container.querySelector("[data-attachment-preview]");
    expect(inline).toBeTruthy();
    const links = within(inline as HTMLElement).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("title"))).toEqual([
      "report.pdf",
      "photo.png",
      "second.png",
    ]);
    expect(screen.queryByRole("img", { name: "last.png" })).toBeNull();
    fireEvent.click(screen.getByText("+1"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "last.png" })).toBeTruthy();
    for (const item of files) {
      expect(within(dialog).getByRole("button", { name: item.fileName })).toBeTruthy();
    }
    fireEvent.click(within(dialog).getByRole("button", { name: "report.pdf" }));
    expect(dialog.querySelector('[data-previewfile-type="pdf"]')).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Open in new tab" }).getAttribute("href")).toBe(
      files[0]?.url,
    );
  });

  it("opens a picture without navigating and returns focus after close", async () => {
    show([file("photo")]);
    const opener = screen.getByRole("link", { name: "photo.png" });
    opener.focus();
    expect(fireEvent.click(opener)).toBe(false);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    const dialog = screen.getByRole("dialog");
    expect(
      (await within(dialog).findByRole("img", { name: "photo.png" })).getAttribute("draggable"),
    ).toBe("false");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("preserves the filename and offers retry when a thumbnail cannot load", () => {
    show([file("unavailable")]);
    const image = screen.getByRole("img", { name: "unavailable.png" });
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("decoding")).toBe("async");
    fireEvent.error(image);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("unavailable.png")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry: unavailable.png" }));
    const retried = screen.getByRole("img", { name: "unavailable.png" });
    expect(retried).not.toBe(image);
    expect(retried.getAttribute("src")).toBe("https://example.com/unavailable");
    fireEvent.load(retried);
    expect(retried.className).not.toContain("opacity-0");
  });

  it("uses durable ACL addresses for assets and never links dangerous legacy URLs", () => {
    show([
      { ...file("asset"), assetId: "ast_photo", url: "https://expired.example/photo" },
      { ...file("unsafe"), url: "javascript:alert(1)" },
      { ...file("local"), url: "blob:untrusted-stored-attachment" },
    ]);
    expect(screen.getByRole("link", { name: "asset.png" }).getAttribute("href")).toBe(
      "/api/assets/ast_photo/raw",
    );
    expect(screen.queryByRole("link", { name: "unsafe.png" })).toBeNull();
    expect(screen.getByText("unsafe.png")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "local.png" })).toBeNull();
    expect(screen.queryByRole("img", { name: "local.png" })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "asset.png" }));
    expect(screen.getByRole("link", { name: "Download file" }).getAttribute("href")).toBe(
      "/api/assets/ast_photo/raw?download=1&filename=asset.png",
    );
  });

  it("keeps all files visible on a record detail and handles empty malformed values", () => {
    const files = [file("one"), file("two"), file("three"), file("four")];
    const result = show(files, false);
    expect(screen.getAllByRole("img")).toHaveLength(4);
    expect(screen.queryByText("+1")).toBeNull();
    result.rerender(
      <CoreI18nProvider locale="en">
        <AttachmentValuePreview value={[null, "bad", { id: "broken" }]} />
      </CoreI18nProvider>,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("keeps the subtitle and single-file switcher row by default", () => {
    show([file("photo")]);
    fireEvent.click(screen.getByRole("link", { name: "photo.png" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("File preview")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "photo.png" })).toBeTruthy();
    // Radix wires aria-describedby to the rendered DialogDescription by
    // default; minimalChrome must not touch this path when it is false.
    expect(dialog.hasAttribute("aria-describedby")).toBe(true);
  });

  it("drops the subtitle and single-file switcher row when minimalChrome is set", () => {
    render(
      <CoreI18nProvider locale="en">
        <AttachmentValuePreview minimalChrome value={[file("photo")]} />
      </CoreI18nProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "photo.png" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "photo.png" })).toBeTruthy();
    expect(within(dialog).queryByText("File preview")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "photo.png" })).toBeNull();
    expect(within(dialog).getByRole("link", { name: "Download file" })).toBeTruthy();
    // No DialogDescription is rendered in this mode, so the dialog must not
    // reference one via aria-describedby — a dangling id would point at an
    // element that no longer exists in the DOM.
    expect(dialog.hasAttribute("aria-describedby")).toBe(false);
  });

  it("still shows the switcher row in minimalChrome mode when there are multiple attachments, and switching updates the heading", () => {
    render(
      <CoreI18nProvider locale="en">
        <AttachmentValuePreview minimalChrome value={[file("one"), file("two")]} />
      </CoreI18nProvider>,
    );
    fireEvent.click(screen.getAllByRole("link")[0] as HTMLElement);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "one.png" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "two.png" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "one.png" })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "two.png" }));
    expect(within(dialog).getByRole("heading", { name: "two.png" })).toBeTruthy();
    expect(within(dialog).queryByRole("heading", { name: "one.png" })).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "two.png" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(dialog).getByRole("button", { name: "one.png" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });
});
