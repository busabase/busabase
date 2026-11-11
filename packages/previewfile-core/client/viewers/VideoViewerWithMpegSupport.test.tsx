import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VideoViewer from "./VideoViewerWithMpegSupport";
import { ViewerLayoutProvider } from "./viewer-layout";

// Video.js is replaced by a recorder: what it was given, and a way to make it fail.
const { players, ffmpegStarted } = vi.hoisted(() => ({
  players: [] as Array<{
    options: { sources: Array<{ src: string; type: string }> };
    fail: (message: string) => void;
  }>,
  ffmpegStarted: vi.fn(),
}));

vi.mock("video.js", () => {
  const videojs = (_el: Element, options: { sources: Array<{ src: string; type: string }> }) => {
    const handlers: Record<string, () => void> = {};
    let error: { message: string } | null = null;
    const player = {
      on: (event: string, handler: () => void) => {
        handlers[event] = handler;
      },
      error: () => error,
      src: vi.fn(),
      dispose: vi.fn(),
    };
    players.push({
      options,
      fail: (message) => {
        error = { message };
        handlers.error?.();
      },
    });
    return player;
  };
  // The viewer's language packs register themselves on import.
  videojs.addLanguage = vi.fn();
  return { default: videojs };
});
vi.mock("video.js/dist/video-js.css", () => ({}));
// A transcode starts by making an FFmpeg: count them. (Counting module loads
// would only see the first, the module being cached after.)
vi.mock("@ffmpeg/ffmpeg", () => ({
  FFmpeg: class {
    constructor() {
      ffmpegStarted();
    }
    on() {}
    load() {
      return new Promise(() => {});
    }
  },
}));
vi.mock("@ffmpeg/util", () => ({ toBlobURL: async (url: string) => url }));

const lastPlayer = () => players[players.length - 1];

beforeEach(() => {
  players.length = 0;
  ffmpegStarted.mockClear();
});

describe("VideoViewer", () => {
  describe("layout", () => {
    const root = (container: HTMLElement) => container.firstElementChild as HTMLElement;

    it("fills the frame of a host that embeds it: the player is absolute in it, so it needs a height", () => {
      const { container } = render(
        <ViewerLayoutProvider layout="fill">
          <VideoViewer fileUrl="https://example.test/clip.mp4" mimeType="video/mp4" />
        </ViewerLayoutProvider>,
      );
      expect(root(container).classList.contains("h-full")).toBe(true);
      expect(root(container).classList.contains("flex-1")).toBe(false);
    });

    it("keeps taking the page's remaining height on the standalone page", () => {
      const { container } = render(
        <VideoViewer fileUrl="https://example.test/clip.mp4" mimeType="video/mp4" />,
      );
      expect(root(container).classList.contains("flex-1")).toBe(true);
      expect(root(container).classList.contains("h-full")).toBe(false);
    });
  });

  describe("without transcoding (an embedding host)", () => {
    it.each([
      ["video/mpeg", "video/mpeg"],
      ["video/mp4", "video/mp4"],
      ["video/webm", "video/webm"],
      ["video/x-msvideo", "video/x-msvideo"],
      // Browsers report no support for video/quicktime although they play the
      // H.264 in it, which would make the player refuse the file unseen.
      ["video/quicktime", "video/mp4"],
    ])(
      "hands a %s file to the player as %s, and never starts the converter",
      async (mime, type) => {
        render(
          <VideoViewer fileUrl="https://example.test/clip" mimeType={mime} transcode={false} />,
        );
        await waitFor(() => expect(players).toHaveLength(1));
        expect(lastPlayer()?.options.sources).toEqual([{ src: "https://example.test/clip", type }]);
        expect(ffmpegStarted).not.toHaveBeenCalled();
      },
    );

    it("says the format is not supported when the browser cannot play it", async () => {
      render(
        <VideoViewer
          fileName="Board meeting.mpeg"
          fileUrl="https://example.test/3qIKPyKy6HwJnGNQOqXmZ"
          mimeType="video/mpeg"
          noDownload={false}
          transcode={false}
        />,
      );
      await waitFor(() => expect(players).toHaveLength(1));

      act(() => lastPlayer()?.fail("No compatible source was found for this media."));

      expect(await screen.findByText("Video Format Not Supported")).toBeTruthy();
      expect(screen.getByText(/No compatible source was found/)).toBeTruthy();
      // The way out: the file itself.
      const download = screen.getByRole("link", { name: /Download Video File/ });
      expect(download.getAttribute("href")).toBe("https://example.test/3qIKPyKy6HwJnGNQOqXmZ");
      // Saved under the file's own name, not the storage key in the URL.
      expect(download.getAttribute("download")).toBe("Board meeting.mpeg");
    });
  });

  describe("with transcoding (PreviewFile)", () => {
    it("still converts MPEG, and does not start the player before it has", async () => {
      render(<VideoViewer fileUrl="https://example.test/clip.mpeg" mimeType="video/mpeg" />);
      await waitFor(() => expect(ffmpegStarted).toHaveBeenCalled());
      expect(players).toHaveLength(0);
    });

    it("still plays what browsers play without converting it", async () => {
      render(<VideoViewer fileUrl="https://example.test/clip.mp4" mimeType="video/mp4" />);
      await waitFor(() => expect(players).toHaveLength(1));
      expect(ffmpegStarted).not.toHaveBeenCalled();
    });
  });
});
