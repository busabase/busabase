import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UnsupportedFileViewer from "../viewers/UnsupportedFileViewer";
import { ViewerLayoutProvider } from "../viewers/viewer-layout";
import { EmbeddedFileViewer } from "./index";

// The video player, as a stub that shows whether it was told to convert.
vi.mock("../viewers/VideoViewerWithMpegSupport", () => ({
  default: ({ transcode }: { transcode?: boolean }) => (
    <p data-testid="video" data-transcode={String(transcode)} />
  ),
}));

const viewerRoot = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("div.bg-muted, div.gap-2");

describe("viewer layout", () => {
  it("keeps the standalone page's viewport height by default", () => {
    const { container } = render(
      <UnsupportedFileViewer fileName="a.bin" fileUrl="/a.bin" mimeType="application/x-unknown" />,
    );

    expect(viewerRoot(container)?.classList.contains("h-[100vh]")).toBe(true);
    expect(viewerRoot(container)?.classList.contains("h-full")).toBe(false);
  });

  it("fills its parent instead when a host embeds it", () => {
    const { container } = render(
      <ViewerLayoutProvider layout="fill">
        <UnsupportedFileViewer fileName="a.bin" fileUrl="/a.bin" mimeType="application/x-unknown" />
      </ViewerLayoutProvider>,
    );

    expect(viewerRoot(container)?.classList.contains("h-full")).toBe(true);
    expect(viewerRoot(container)?.className).not.toContain("100vh");
  });
});

describe("EmbeddedFileViewer", () => {
  it("renders FileViewer inside a full-size frame, in the fill layout", () => {
    const { container } = render(
      <div style={{ height: 300 }}>
        <EmbeddedFileViewer fileName="blob.unknownext" mimeType="application/x-unknown" url="/x" />
      </div>,
    );

    const frame = container.querySelector<HTMLElement>("[data-previewfile-viewer]");
    expect(frame?.classList.contains("h-full")).toBe(true);
    expect(frame?.classList.contains("w-full")).toBe(true);

    // The "unsupported" card takes the frame's height, not the viewport's.
    const card = screen.getByText("Preview Not Available").closest<HTMLElement>("div.bg-muted");
    expect(card?.classList.contains("h-full")).toBe(true);
    expect(card?.className).not.toContain("100vh");
  });

  it("leaves downloading to the host unless told otherwise", () => {
    render(<EmbeddedFileViewer fileName="blob.unknownext" mimeType="" url="/x" />);
    expect(screen.queryByRole("link", { name: /download/i })).toBeNull();
    // Nor does it claim downloading is disabled: that is the host's call.
    expect(screen.queryByText(/download is disabled/i)).toBeNull();
  });

  it("offers the viewer's own download when the host asks for it", () => {
    render(
      <EmbeddedFileViewer fileName="blob.unknownext" mimeType="" noDownload={false} url="/x" />,
    );
    expect(screen.getByRole("link", { name: /download blob\.unknownext/i })).toBeTruthy();
  });

  it("leaves MPEG and MOV to the browser: converting them is a ~30 MB download from a third party", async () => {
    render(<EmbeddedFileViewer fileName="clip.mpeg" mimeType="video/mpeg" url="/clip.mpeg" />);
    expect((await screen.findByTestId("video")).dataset.transcode).toBe("false");
  });

  it("converts them when the host asks for it", async () => {
    render(
      <EmbeddedFileViewer fileName="clip.mpeg" mimeType="video/mpeg" transcodeVideo url="/x" />,
    );
    expect((await screen.findByTestId("video")).dataset.transcode).toBe("true");
  });

  it("renders 3D models with the viewer a host passes", async () => {
    const Model3D = ({ fileName }: { fileName?: string }) => <p>3D viewer for {fileName}</p>;
    render(
      <EmbeddedFileViewer
        fileName="part.stl"
        mimeType="model/stl"
        model3dViewer={Model3D}
        url="/part.stl"
      />,
    );
    expect(await screen.findByText("3D viewer for part.stl")).toBeTruthy();
  });

  it("shows 3D models as unsupported when the host has no 3D viewer", () => {
    render(<EmbeddedFileViewer fileName="part.stl" mimeType="model/stl" url="/part.stl" />);
    expect(screen.getByText("Preview Not Available")).toBeTruthy();
  });

  it.each([
    ["zh-CN", "无法预览"],
    ["zh-Hant-TW", "無法預覽"],
    ["ja", "プレビューできません"],
    ["ko", "미리보기를 사용할 수 없습니다"],
    ["pt-BR", "Visualização indisponível"],
    ["de", "Vorschau nicht verfügbar"],
    ["es-MX", "Vista previa no disponible"],
    ["fr", "Aperçu non disponible"],
    ["vi", "Không có bản xem trước"],
    // A language the viewer has no strings for falls back to English.
    ["ar", "Preview Not Available"],
  ])("speaks the host's language (%s)", (locale, title) => {
    render(<EmbeddedFileViewer fileName="blob.unknownext" locale={locale} mimeType="" url="/x" />);
    expect(screen.getByText(title)).toBeTruthy();
  });
});
