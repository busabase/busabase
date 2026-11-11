// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { AssetMediaPreview } from "./assets";
import { FileViewerSlotProvider } from "./file-viewer-slot";
import { createPreviewFileHostViewer } from "./previewfile-host-viewer";

vi.mock(
  "previewfile-core/client/embedded/lazy",
  () => import("../../../../tests/mocks/embedded-file-viewer"),
);

afterEach(cleanup);

describe("file viewer scopes", () => {
  it.each([
    ["photo.png", "image/png"],
    ["notes.md", "text/markdown"],
    ["source.json", "application/json"],
    ["report.pdf", "application/pdf"],
    ["table.xlsx", "application/octet-stream"],
    ["bundle.zip", "application/zip"],
    ["clip.mp4", "video/mp4"],
  ])(
    "uses the shared attachment viewer for %s with and without a Cloud registration",
    (name, mimeType) => {
      const preview = (
        <AssetMediaPreview
          viewerScope="attachment"
          name={name}
          mimeType={mimeType}
          url="/original"
          mediaClassName="h-full"
        />
      );
      const result = render(<CoreI18nProvider>{preview}</CoreI18nProvider>);
      expect(screen.getByTestId("embedded-file-preview").getAttribute("data-file-name")).toBe(name);
      expect(screen.getByTestId("embedded-file-preview").getAttribute("data-url")).toBe(
        "/original",
      );
      result.rerender(
        <CoreI18nProvider>
          <FileViewerSlotProvider
            value={createPreviewFileHostViewer({ locale: "en", officeConversion: true })}
          >
            {preview}
          </FileViewerSlotProvider>
        </CoreI18nProvider>,
      );
      expect(screen.getByTestId("embedded-file-preview").getAttribute("data-file-name")).toBe(name);
    },
  );

  it("keeps native inline images with a Cloud registration and hands its spreadsheets to the host", () => {
    const viewer = createPreviewFileHostViewer({ locale: "en", officeConversion: true });
    const result = render(
      <CoreI18nProvider>
        <FileViewerSlotProvider value={viewer}>
          <AssetMediaPreview
            name="photo.png"
            mimeType="image/png"
            url="/photo"
            mediaClassName="h-full"
          />
        </FileViewerSlotProvider>
      </CoreI18nProvider>,
    );
    expect(screen.getByRole("img").getAttribute("src")).toBe("/photo");
    expect(screen.queryByTestId("embedded-file-preview")).toBeNull();
    result.rerender(
      <CoreI18nProvider>
        <FileViewerSlotProvider value={viewer}>
          <AssetMediaPreview
            name="table.xlsx"
            mimeType="application/octet-stream"
            url="/table"
            mediaClassName="h-full"
          />
        </FileViewerSlotProvider>
      </CoreI18nProvider>,
    );
    expect(screen.getByTestId("embedded-file-preview").getAttribute("data-url")).toBe("/table");
  });
});
