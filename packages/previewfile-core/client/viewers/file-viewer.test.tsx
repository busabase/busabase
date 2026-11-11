import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileViewer, type FileViewerProps } from "./file-viewer";

// Each leaf viewer is replaced by a stub that names itself and echoes the
// props FileViewer handed it, so the routing is tested without the viewers.
const stub = (name: string) => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="viewer" data-name={name} data-props={JSON.stringify(props)} />
  ),
});
vi.mock("./PdfViewer", () => stub("PdfViewer"));
vi.mock("./ImageViewer", () => stub("ImageViewer"));
vi.mock("./TiffViewer", () => stub("TiffViewer"));
vi.mock("./PsdViewer", () => stub("PsdViewer"));
vi.mock("./VideoViewerWithMpegSupport", () => stub("VideoViewer"));
vi.mock("./AudioViewer", () => stub("AudioViewer"));
vi.mock("./SilkAudioViewer", () => stub("SilkAudioViewer"));
vi.mock("./SrtViewer", () => stub("SrtViewer"));
vi.mock("./XlsxPreview", () => stub("XlsxPreview"));
vi.mock("./DocxViewer", () => stub("DocxViewer"));
vi.mock("./OfficeViewer", () => stub("OfficeViewer"));
vi.mock("./MarkdownViewer", () => stub("MarkdownViewer"));
vi.mock("./CodeViewer", () => stub("CodeViewer"));
vi.mock("./EpubViewer", () => stub("EpubViewer"));
vi.mock("./ArchiveViewer", () => stub("ArchiveViewer"));
vi.mock("./SqliteViewer", () => stub("SqliteViewer"));

const show = async (props: Partial<FileViewerProps> & { fileName: string }) => {
  render(<FileViewer mimeType="" url="/files/x" {...props} />);
  const viewer = await screen.findByTestId("viewer");
  return {
    name: viewer.dataset.name,
    props: JSON.parse(viewer.dataset.props ?? "{}") as Record<string, unknown>,
  };
};

describe("FileViewer", () => {
  it.each([
    ["report.pdf", "PdfViewer"],
    ["photo.png", "ImageViewer"],
    ["scan.tiff", "TiffViewer"],
    ["layers.psd", "PsdViewer"],
    ["clip.mp4", "VideoViewer"],
    ["memo.mp3", "AudioViewer"],
    ["voice.silk", "SilkAudioViewer"],
    ["captions.srt", "SrtViewer"],
    ["sheet.xlsx", "XlsxPreview"],
    ["export.csv", "XlsxPreview"],
    ["proposal.docx", "DocxViewer"],
    ["old.doc", "OfficeViewer"],
    ["deck.pptx", "OfficeViewer"],
    ["README.md", "MarkdownViewer"],
    ["main.py", "CodeViewer"],
    ["notes.txt", "CodeViewer"],
    ["book.epub", "EpubViewer"],
    ["bundle.zip", "ArchiveViewer"],
    ["crm.sqlite", "SqliteViewer"],
  ])("shows %s with %s", async (fileName, expected) => {
    expect((await show({ fileName })).name).toBe(expected);
  });

  it("draws a .docx in the browser for every host, with the share link for its fallback", async () => {
    const { name, props } = await show({
      fileName: "proposal.docx",
      previewSession: { shortUrl: "abc123", accessPassword: "11" },
    });
    expect(name).toBe("DocxViewer");
    expect(props).toMatchObject({ shortUrl: "abc123", accessPassword: "11" });
  });

  it("hands every viewer the watermark and download policy", async () => {
    const { props } = await show({ fileName: "sheet.xlsx", watermark: "ACME", noDownload: true });
    expect(props).toMatchObject({ fileUrl: "/files/x", watermark: "ACME", noDownload: true });
  });

  it("ties an Office conversion to the PreviewFile preview it belongs to", async () => {
    const { props } = await show({
      fileName: "deck.pptx",
      previewSession: { shortUrl: "abc123", accessPassword: "11" },
    });
    expect(props).toMatchObject({ shortUrl: "abc123", accessPassword: "11" });
  });

  it("converts MPEG and MOV in the browser unless a host turns that off", async () => {
    expect((await show({ fileName: "clip.mpeg" })).props.transcode).toBe(true);
  });

  it("passes on a host's wish not to convert video", async () => {
    const { props } = await show({ fileName: "clip.mpeg", transcodeVideo: false });
    expect(props.transcode).toBe(false);
  });

  it("gives the player no type rather than a generic one", async () => {
    // A Drive file saved without its type arrives as application/octet-stream.
    const { props } = await show({ fileName: "clip.mp4", mimeType: "application/octet-stream" });
    expect(props.mimeType).toBeUndefined();
  });

  it("gives the player the video type a host knows", async () => {
    const { props } = await show({ fileName: "clip.avi", mimeType: "video/x-msvideo" });
    expect(props.mimeType).toBe("video/x-msvideo");
  });

  it("shows 3D models only with the viewer a host opts into", async () => {
    const Model3D = (props: { fileName: string }) => (
      <div data-testid="viewer" data-name="Model3D" data-props={JSON.stringify(props)} />
    );
    expect((await show({ fileName: "part.stl", model3dViewer: Model3D })).name).toBe("Model3D");
  });

  it("falls back to the unsupported card", () => {
    render(<FileViewer fileName="part.stl" mimeType="" url="/files/x" />);
    expect(screen.getByText("Preview Not Available")).toBeTruthy();
  });
});
