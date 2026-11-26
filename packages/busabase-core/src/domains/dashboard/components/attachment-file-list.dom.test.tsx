// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { AssetContentUrlProvider } from "../../assets/hooks/asset-content-url-context";
import { AttachmentFileList } from "./attachment-file-list";
import type { AttachmentPreviewEntry } from "./attachment-preview-dialog";

const entry = (
  key: string,
  fileName = `${key}.pdf`,
  mimeType = "application/pdf",
): AttachmentPreviewEntry => ({
  key,
  item: { id: key, fileName, mimeType, url: `https://example.com/${key}`, size: 100 },
  url: `https://example.com/resolved/${key}?token=signed`,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("shared attachment file list", () => {
  it("keeps Grid lists free of preview actions by default", () => {
    render(<AttachmentFileList entries={[entry("first")]} onSelect={vi.fn()} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("offers independent download and new-tab actions without selecting the file", () => {
    const file = entry("first", "Project report.pdf");
    const onSelect = vi.fn();
    render(
      <CoreI18nProvider locale="en">
        <AttachmentFileList entries={[file]} onSelect={onSelect} showActions />
      </CoreI18nProvider>,
    );
    const select = screen.getByRole("button", { name: file.item.fileName });
    const download = screen.getByRole("link", { name: "Download file: Project report.pdf" });
    const open = screen.getByRole("link", { name: "Open in new tab: Project report.pdf" });
    expect(download.getAttribute("href")).toBe(file.url);
    expect(download.getAttribute("download")).toBe(file.item.fileName);
    expect(open.getAttribute("href")).toBe(file.url);
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noreferrer");
    expect(select.contains(download)).toBe(false);
    expect(select.contains(open)).toBe(false);
    for (const action of [download, open]) {
      action.addEventListener("click", (event) => event.preventDefault(), { once: true });
      fireEvent.click(action);
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("uses the host-authorized download URL and hides actions for unavailable files", () => {
    const file = entry("private");
    file.item.assetId = "asset-private";
    const resolve = vi.fn(() => "/embed/shared/assets/asset-private/raw?download=1");
    render(
      <CoreI18nProvider locale="en">
        <AssetContentUrlProvider value={resolve}>
          <AttachmentFileList
            entries={[file, { ...entry("unavailable"), url: null }]}
            onSelect={vi.fn()}
            showActions
          />
        </AssetContentUrlProvider>
      </CoreI18nProvider>,
    );
    expect(resolve).toHaveBeenCalledWith("asset-private", {
      download: true,
      fileName: "private.pdf",
    });
    expect(
      screen.getByRole("link", { name: "Download file: private.pdf" }).getAttribute("href"),
    ).toBe("/embed/shared/assets/asset-private/raw?download=1");
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("preserves duplicate occurrences and their order across updates", () => {
    const first = entry("first");
    const duplicate = { ...first, key: "duplicate" };
    const middle = entry("middle");
    const onSelect = vi.fn();
    const result = render(
      <AttachmentFileList entries={[first, middle, duplicate]} onSelect={onSelect} />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.dataset.attachmentKey)).toEqual([
      "first",
      "middle",
      "duplicate",
    ]);
    expect(buttons.map((button) => button.dataset.attachmentIndex)).toEqual(["0", "1", "2"]);
    expect(buttons.every((button) => button.hasAttribute("data-attachment-cell-item"))).toBe(true);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "first.pdf",
      "middle.pdf",
      "first.pdf",
    ]);
    result.rerender(
      <AttachmentFileList entries={[duplicate, first, middle]} onSelect={onSelect} />,
    );
    expect(screen.getAllByRole("button")).toEqual([buttons[2], buttons[0], buttons[1]]);
  });

  it("only exposes pressed states when selection is supplied and passes the occurrence and click", () => {
    const first = entry("first", "same.pdf");
    const second = { ...first, key: "second" };
    const onSelect = vi.fn();
    const result = render(<AttachmentFileList entries={[first, second]} onSelect={onSelect} />);
    expect(
      screen.getAllByRole("button").map((button) => button.getAttribute("aria-pressed")),
    ).toEqual([null, null]);
    result.rerender(
      <AttachmentFileList entries={[first, second]} onSelect={onSelect} selectedKey="second" />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(fireEvent.click(buttons[1] as HTMLElement, { ctrlKey: true })).toBe(true);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(
      second,
      expect.objectContaining({ type: "click", ctrlKey: true, defaultPrevented: false }),
    );
  });

  it("uses lazy decorative thumbnails from resolved URLs and icons for text or unavailable images", () => {
    const image = entry("image", "photo.png", "image/png");
    const text = entry("text", "readme.md", "image/png");
    const unavailable = { ...entry("unavailable", "private.png", "image/png"), url: null };
    render(<AttachmentFileList entries={[image, text, unavailable]} onSelect={vi.fn()} />);
    const thumbnail = screen.getByRole("button", { name: "photo.png" }).querySelector("img");
    expect(thumbnail?.getAttribute("src")).toBe(image.url);
    expect(thumbnail?.getAttribute("alt")).toBe("");
    expect(thumbnail?.getAttribute("loading")).toBe("lazy");
    for (const name of ["readme.md", "private.png"]) {
      const button = screen.getByRole("button", { name });
      expect(button.querySelector("img")).toBeNull();
      expect(button.querySelector("[data-attachment-file-kind]")).toBeTruthy();
    }
  });

  it("falls back to a file icon after a thumbnail fails and retries a changed URL", () => {
    const image = entry("image", "photo.png", "image/png");
    const view = render(<AttachmentFileList entries={[image]} onSelect={vi.fn()} />);
    const row = screen.getByRole("button", { name: "photo.png" });
    const thumbnail = row.querySelector("img");
    expect(thumbnail).not.toBeNull();
    fireEvent.error(thumbnail as HTMLImageElement);
    expect(row.querySelector("img")).toBeNull();
    expect(row.querySelector("[data-attachment-file-kind]")).toBeTruthy();
    view.rerender(
      <AttachmentFileList
        entries={[{ ...image, url: "https://example.com/renewed-image.png" }]}
        onSelect={vi.fn()}
      />,
    );
    expect(row.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/renewed-image.png",
    );
  });

  it.each([
    ["A very long project report with several revisions.final.pdf", ".pdf"],
    ["no-extension", ""],
    [".env", ""],
    ["trailing.", ""],
    [`report.${"extension".repeat(100)}`, `.${"extension".repeat(100)}`],
  ])("keeps the full name and a separate extension for %s", (fileName, extension) => {
    render(<AttachmentFileList entries={[entry("file", fileName)]} onSelect={vi.fn()} />);
    const button = screen.getByRole("button", { name: fileName });
    expect(button.title).toBe(fileName);
    const stem = button.querySelector(".line-clamp-2");
    expect(stem?.parentElement?.textContent).toBe(fileName);
    expect(stem?.parentElement?.getAttribute("title")).toBe(fileName);
    expect(stem?.classList.contains("break-all")).toBe(true);
    expect(stem?.nextElementSibling?.textContent ?? "").toBe(extension);
    if (extension) {
      expect(stem?.nextElementSibling?.classList.contains("shrink-0")).toBe(true);
      expect(stem?.nextElementSibling?.classList.contains("max-w-1/2")).toBe(true);
      expect(stem?.nextElementSibling?.classList.contains("truncate")).toBe(true);
    }
  });

  it.each([80, 280])(
    "scrolls the selected occurrence nearest on activation when outside at %i",
    (top) => {
      const files = [entry("first"), entry("selected"), entry("last")];
      const onSelect = vi.fn();
      const result = render(
        <AttachmentFileList
          active={false}
          entries={files}
          onSelect={onSelect}
          selectedKey="selected"
        />,
      );
      const list = screen.getByRole("list");
      const buttons = screen.getAllByRole("button");
      const scroll = vi.fn();
      const selected = buttons[1] as HTMLElement;
      Object.defineProperty(selected, "scrollIntoView", { value: scroll });
      vi.spyOn(list, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 300, 200));
      vi.spyOn(selected, "getBoundingClientRect").mockReturnValue(new DOMRect(0, top, 300, 40));
      list.scrollTop = 88;
      expect(scroll).not.toHaveBeenCalled();
      result.rerender(
        <AttachmentFileList active entries={files} onSelect={onSelect} selectedKey="selected" />,
      );
      expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "nearest", inline: "nearest" });
      expect(list.scrollTop).toBe(88);
      result.rerender(
        <AttachmentFileList
          active
          entries={[...files]}
          onSelect={onSelect}
          selectedKey="selected"
        />,
      );
      expect(scroll).toHaveBeenCalledOnce();
    },
  );

  it("keeps visible selections and existing scroll position, then reveals a changed offscreen selection", () => {
    const files = [entry("first"), entry("next")];
    const onSelect = vi.fn();
    const result = render(
      <AttachmentFileList active={false} entries={files} onSelect={onSelect} selectedKey="first" />,
    );
    const list = screen.getByRole("list");
    const [first, next] = screen.getAllByRole("button") as [HTMLElement, HTMLElement];
    const scrollFirst = vi.fn();
    const scrollNext = vi.fn();
    Object.defineProperty(first, "scrollIntoView", { value: scrollFirst });
    Object.defineProperty(next, "scrollIntoView", { value: scrollNext });
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 300, 200));
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 300, 40));
    vi.spyOn(next, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 320, 300, 40));
    list.scrollTop = 144;
    result.rerender(
      <AttachmentFileList active entries={files} onSelect={onSelect} selectedKey="first" />,
    );
    expect(scrollFirst).not.toHaveBeenCalled();
    expect(list.scrollTop).toBe(144);
    result.rerender(
      <AttachmentFileList active entries={files} onSelect={onSelect} selectedKey="next" />,
    );
    expect(scrollFirst).not.toHaveBeenCalled();
    expect(scrollNext).toHaveBeenCalledExactlyOnceWith({ block: "nearest", inline: "nearest" });
    expect(list.scrollTop).toBe(144);
  });
});
