import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SrtViewer from "./SrtViewer";

const { mockUseFileFetch } = vi.hoisted(() => ({ mockUseFileFetch: vi.fn() }));

vi.mock("previewfile-core/client/file-fetch", () => ({ useFileFetch: mockUseFileFetch }));

const showFile = (data: string) =>
  mockUseFileFetch.mockReturnValue({ data, loading: false, error: null, refetch: vi.fn() });

describe("SrtViewer", () => {
  it("lists the cues of an SRT file", async () => {
    showFile("1\n00:00:01,000 --> 00:00:03,000\nQuarterly review\n");
    render(<SrtViewer fileUrl="/captions.srt" />);

    expect(await screen.findByText("Quarterly review")).toBeInTheDocument();
    expect(screen.getByText("00:00:01,000 --> 00:00:03,000")).toBeInTheDocument();
  });

  it("lists the cues of a WebVTT file", async () => {
    showFile(
      "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nQuarterly review\n\n00:03.500 --> 00:06.000\nFollow-up\n",
    );
    render(<SrtViewer fileUrl="/captions.vtt" />);

    expect(await screen.findByText("Quarterly review")).toBeInTheDocument();
    expect(screen.getByText("Follow-up")).toBeInTheDocument();
    expect(screen.getByText("00:00:03,500 --> 00:00:06,000")).toBeInTheDocument();
    expect(screen.queryByText("No subtitles found or empty file.")).not.toBeInTheDocument();
  });

  it("says an empty file has no subtitles, rather than loading forever", async () => {
    showFile("");
    render(<SrtViewer fileUrl="/empty.srt" />);

    expect(await screen.findByText("No subtitles found or empty file.")).toBeInTheDocument();
  });
});
