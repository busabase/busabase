// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { FileDownloadButton, FilePreviewSurface } from "./file-preview-surface";

/**
 * A File node had no way to save its file. The node menu is Settings, Rename,
 * Permissions, Activity, Share, Delete; the viewers that draw a PDF, a document
 * or audio run without their own download controls inside the dashboard; and
 * video, which used to carry the browser player's "Download", lost it when it
 * moved to the shared viewer. A Drive had a button, a File node nothing.
 */
afterEach(cleanup);

const withI18n = (ui: React.ReactElement, locale: "en" | "zh-CN" = "en") =>
  render(<CoreI18nProvider locale={locale}>{ui}</CoreI18nProvider>);

describe("FileDownloadButton", () => {
  it("saves the asset through the raw-content route, under the file's own name", () => {
    withI18n(<FileDownloadButton assetId="ast_1" fileName="季度 报告.pdf" />);
    const link = screen.getByRole("link", { name: "Download file" });
    expect(link.getAttribute("download")).toBe("季度 报告.pdf");
    expect(link.getAttribute("href")).toBe(
      `/api/assets/ast_1/raw?download=1&filename=${encodeURIComponent("季度 报告.pdf").replace(/%20/g, "+")}`,
    );
  });

  it("is labelled in the member's language", () => {
    withI18n(<FileDownloadButton assetId="ast_1" fileName="a.pdf" />, "zh-CN");
    expect(screen.getByRole("link", { name: "下载文件" })).toBeTruthy();
  });
});

describe("a pinned File node's preview toolbar", () => {
  const surface = (assetId?: string) => (
    <FilePreviewSurface
      assetId={assetId}
      fullscreenState={{ fullscreen: false, setFullscreen: vi.fn() }}
      mimeType="application/pdf"
      name="plan.pdf"
      showToolbar
      url="/files/plan.pdf"
    />
  );

  it("offers the download next to the file's name", () => {
    withI18n(surface("ast_9"));
    const link = screen.getByRole("link", { name: "Download file" });
    expect(link.getAttribute("href")).toContain("/api/assets/ast_9/raw?download=1");
  });

  it("offers none where it does not know the asset", () => {
    withI18n(surface());
    expect(screen.queryByRole("link", { name: "Download file" })).toBeNull();
  });
});
