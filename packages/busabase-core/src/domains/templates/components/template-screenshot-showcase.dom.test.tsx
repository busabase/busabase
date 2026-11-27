// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TemplateScreenshotShowcase } from "./template-screenshot-showcase";
import { TemplateVideoPreview } from "./template-video-preview";

const first = "https://cdn.example/original-first.png";
const second = "https://cdn.example/original-second.png";
const props = {
  screenshots: [
    { src: first, alt: "First screenshot" },
    { src: second, alt: "Second screenshot" },
  ],
  label: "Screenshots",
  previousLabel: "Previous screenshot",
  nextLabel: "Next screenshot",
  closeLabel: "Close preview",
  zoomOutLabel: "Zoom out",
  zoomInLabel: "Zoom in",
  resetLabel: "Reset view",
  rotateLabel: "Rotate",
  downloadLabel: "Download",
};

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

describe("TemplateVideoPreview poster composition", () => {
  it("replaces only the tile image and keeps the original clip and player poster", () => {
    const src = "https://cdn.example/original.mp4";
    const poster = "https://cdn.example/original-poster.png";
    render(
      <TemplateVideoPreview
        src={src}
        poster={poster}
        title="Example template"
        playLabel="Play demo"
        clipTitle="Walkthrough"
        posterImage={<img src="/responsive-poster.webp" alt="Responsive poster" />}
      />,
    );
    expect(screen.getByRole("img", { name: "Responsive poster" }).getAttribute("src")).toBe(
      "/responsive-poster.webp",
    );
    expect(document.querySelector("video")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play demo" }));
    const dialog = screen.getByRole("dialog");
    const player = dialog.querySelector("video");
    expect(player?.getAttribute("src")).toBe(src);
    expect(player?.getAttribute("poster")).toBe(poster);
    expect(player?.hasAttribute("controls")).toBe(true);
    expect(player?.hasAttribute("autoplay")).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(document.querySelector("video")).toBeNull();
  });

  it("keeps a native poster by default", () => {
    const poster = "https://cdn.example/original-poster.png";
    render(
      <TemplateVideoPreview
        src="https://cdn.example/original.mp4"
        poster={poster}
        title="Example template"
        playLabel="Play demo"
      />,
    );
    expect(screen.getByRole("img", { name: "Example template" }).getAttribute("src")).toBe(poster);
    expect(document.querySelector("video")).toBeNull();
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TemplateScreenshotShowcase thumbnail slots", () => {
  it("keeps original native thumbnails when no override is supplied", () => {
    render(<TemplateScreenshotShowcase {...props} />);
    expect(screen.getByRole("img", { name: "First screenshot" }).getAttribute("src")).toBe(first);
    expect(screen.getByRole("img", { name: "Second screenshot" }).getAttribute("src")).toBe(second);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps thumbnail indices separate from inserted clips and previews/downloads the original", async () => {
    const requested = vi
      .fn()
      .mockRejectedValue(new Error("Use the existing download-link fallback"));
    vi.stubGlobal("fetch", requested);
    const downloads: Array<{ href: string; filename: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ href: this.href, filename: this.download });
    });
    render(
      <TemplateScreenshotShowcase
        {...props}
        videoTiles={[<span key="clip">Demo clip</span>]}
        thumbnailImages={[
          <img key="first" src="/optimized-first.webp" alt="First thumbnail" />,
          <img key="second" src="/optimized-second.webp" alt="Second thumbnail" />,
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByRole("img").getAttribute("src")).toBe("/optimized-first.webp");
    expect(items[1].textContent).toBe("Demo clip");
    expect(within(items[2]).getByRole("img").getAttribute("src")).toBe("/optimized-second.webp");
    fireEvent.click(screen.getByRole("button", { name: "Second screenshot" }));
    const dialog = screen.getByRole("dialog");
    const preview = within(dialog).getByRole("img", { name: "Second screenshot" });
    expect(preview.getAttribute("src")).toBe(second);
    expect(preview.getAttribute("loading")).toBe("eager");
    fireEvent.click(within(dialog).getByRole("button", { name: "Zoom in" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Rotate" }));
    expect(preview.getAttribute("style")).toContain("rotate(90deg) scale(1.25)");
    fireEvent.click(within(dialog).getByRole("button", { name: "Download" }));
    await waitFor(() => expect(requested).toHaveBeenCalledWith(second));
    expect(downloads).toEqual([{ href: second, filename: "original-second.png" }]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close preview" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
