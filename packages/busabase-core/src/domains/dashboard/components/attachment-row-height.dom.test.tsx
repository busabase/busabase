// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { AttachmentValuePreview } from "./attachment-value-preview";

const files = Array.from({ length: 12 }, (_, index) => ({
  id: `file-${index}`,
  url: `https://example.com/file-${index}`,
  fileName: `review-${index}.${index % 2 ? "pdf" : "png"}`,
  mimeType: index % 2 ? "application/pdf" : "image/png",
  size: 100,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("attachment row-height presentation", () => {
  it.each([
    [32, 24],
    [48, 32],
    [96, 80],
    [144, 128],
  ])("fits mixed previews and controls inside a %ipx row", (rowHeight, thumbnailSize) => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
    const rendered = render(
      <CoreI18nProvider locale="en">
        <AttachmentValuePreview presentation="grid" rowHeight={rowHeight} value={files} />
      </CoreI18nProvider>,
    );
    const preview = rendered.container.querySelector("[data-attachment-preview]") as HTMLElement;
    expect(preview.dataset.attachmentThumbnailSize).toBe(String(thumbnailSize));
    expect(Number.parseInt(preview.style.height, 10)).toBeLessThanOrEqual(rowHeight - 8);
    for (const tile of preview.querySelectorAll("a")) {
      expect((tile as HTMLElement).style.height).toBe(`${thumbnailSize}px`);
      expect((tile as HTMLElement).style.width).toBe(`${thumbnailSize}px`);
    }
    fireEvent.click(within(preview).getByRole("button", { name: "Expand: File preview" }));
    const expanded = screen.getByTestId("attachment-cell-expanded");
    expect(expanded.querySelectorAll("[data-attachment-cell-item]")).toHaveLength(files.length);
    fireEvent.click(within(expanded).getByRole("button", { name: "review-11.pdf" }));
    expect(
      within(screen.getByTestId("attachment-preview-dialog")).getByRole("heading", {
        name: "review-11.pdf",
      }),
    ).toBeTruthy();
  });

  it("shrinks tall thumbnails to retain a useful preview in a narrow column", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(110);
    const rendered = render(
      <CoreI18nProvider locale="en">
        <AttachmentValuePreview presentation="grid" rowHeight={144} value={files} />
      </CoreI18nProvider>,
    );
    const preview = rendered.container.querySelector("[data-attachment-preview]") as HTMLElement;
    expect(preview.dataset.attachmentThumbnailSize).toBe("42");
    expect(preview.dataset.attachmentVisibleCount).toBe("1");
    expect(within(preview).getByText("+11")).toBeTruthy();
    const image = within(preview).getByAltText("review-0.png");
    fireEvent.error(image);
    const retry = within(preview).getByRole("button", { name: "Retry: review-0.png" });
    fireEvent.click(retry);
    expect(within(preview).getByAltText("review-0.png")).toBeTruthy();
  });

  it("leaves flow previews independent of the selected table density", () => {
    const rendered = render(
      <CoreI18nProvider locale="en">
        <AttachmentValuePreview rowHeight={144} value={files.slice(0, 2)} />
      </CoreI18nProvider>,
    );
    const preview = rendered.container.querySelector("[data-attachment-preview]") as HTMLElement;
    expect(preview.style.height).toBe("");
    expect(preview.dataset.attachmentThumbnailSize).toBeUndefined();
    expect(preview.querySelector("a")?.className).toContain("h-12");
  });
});
