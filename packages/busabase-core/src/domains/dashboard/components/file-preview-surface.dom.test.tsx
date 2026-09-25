// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CoreI18nProvider, coreMessagesByLocale } from "../../../i18n";
import { FilePreviewSurface } from "./file-preview-surface";
import {
  PreviewFullscreenButton,
  type PreviewFullscreenState,
  usePreviewFullscreen,
} from "./preview-fullscreen";

function Providers({ children }: { children: ReactNode }) {
  return <CoreI18nProvider locale="en">{children}</CoreI18nProvider>;
}

function UrlFullscreenHarness({ mimeType }: { mimeType: string }) {
  const fullscreenState = usePreviewFullscreen({ syncWithUrl: true });
  return (
    <Providers>
      <PreviewFullscreenButton
        fullscreenState={fullscreenState}
        label={coreMessagesByLocale.en.airapp.enterFullscreen}
      />
      <FilePreviewSurface
        fullscreenState={fullscreenState}
        mimeType={mimeType}
        name="preview-file"
        url="/preview-file"
      />
    </Providers>
  );
}

function LocalFullscreenHarness({ mimeType }: { mimeType: string }) {
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenState: PreviewFullscreenState = { fullscreen, setFullscreen };
  return (
    <Providers>
      <FilePreviewSurface
        fullscreenState={fullscreenState}
        mimeType={mimeType}
        name="pinned-file"
        showToolbar
        url="/pinned-file"
      />
    </Providers>
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("FilePreviewSurface", () => {
  it.each([
    ["image/svg+xml", "img"],
    ["video/mp4", "video"],
    ["application/pdf", "iframe"],
  ])("renders the %s native media branch", (mimeType, selector) => {
    const state: PreviewFullscreenState = { fullscreen: false, setFullscreen: () => undefined };
    const { container } = render(
      <Providers>
        <FilePreviewSurface
          fullscreenState={state}
          mimeType={mimeType}
          name="native-preview"
          url="/native-preview"
        />
      </Providers>,
    );

    expect(container.querySelector(selector)).not.toBeNull();
    expect(container.querySelector("[data-file-media-frame]")).not.toBeNull();
  });

  it("renders the inline PDF edge-to-edge without a viewport height cap", () => {
    const state: PreviewFullscreenState = { fullscreen: false, setFullscreen: () => undefined };
    const { container } = render(
      <Providers>
        <FilePreviewSurface
          fullscreenState={state}
          mimeType="application/pdf"
          name="report.pdf"
          url="/report.pdf"
        />
      </Providers>,
    );

    const body = container.querySelector<HTMLElement>("[data-preview-fullscreen-body]");
    const frame = container.querySelector<HTMLElement>("[data-file-media-frame]");
    const pdf = container.querySelector<HTMLIFrameElement>('[data-asset-preview="pdf"]');

    expect(body?.classList.contains("p-0")).toBe(true);
    expect(body?.classList.contains("p-4")).toBe(false);
    expect(body?.classList.contains("md:p-6")).toBe(false);
    expect(frame?.classList.contains("h-full")).toBe(true);
    expect(frame?.classList.contains("min-h-0")).toBe(true);
    expect(frame?.classList.contains("w-full")).toBe(true);
    expect(frame?.classList.contains("rounded-md")).toBe(false);
    expect(frame?.classList.contains("border")).toBe(false);
    expect(frame?.classList.contains("max-w-5xl")).toBe(false);
    expect(pdf?.classList.contains("h-full")).toBe(true);
    expect(pdf?.classList.contains("max-h-full")).toBe(true);
    expect(pdf?.className).not.toContain("vh");
  });

  it.each([
    ["image/svg+xml", "img"],
    ["video/mp4", "video"],
  ])("keeps inline %s media contained within the existing viewport cap", (mimeType, selector) => {
    const state: PreviewFullscreenState = { fullscreen: false, setFullscreen: () => undefined };
    const { container } = render(
      <Providers>
        <FilePreviewSurface
          fullscreenState={state}
          mimeType={mimeType}
          name="contained-preview"
          url="/contained-preview"
        />
      </Providers>,
    );

    const body = container.querySelector<HTMLElement>("[data-preview-fullscreen-body]");
    const frame = container.querySelector<HTMLElement>("[data-file-media-frame]");
    const media = container.querySelector<HTMLElement>(selector);
    expect(body?.classList.contains("p-4")).toBe(true);
    expect(body?.classList.contains("md:p-6")).toBe(true);
    expect(frame?.classList.contains("min-h-[320px]")).toBe(true);
    expect(frame?.classList.contains("max-w-5xl")).toBe(true);
    expect(frame?.classList.contains("rounded-md")).toBe(true);
    expect(frame?.classList.contains("border")).toBe(true);
    expect(media?.classList.contains("max-h-[65vh]")).toBe(true);
    expect(media?.classList.contains("object-contain")).toBe(true);
  });

  it("keeps the same main video and playback position through URL fullscreen", async () => {
    window.history.replaceState(null, "", "/dashboard/file?demo=node-types");
    const { container } = render(<UrlFullscreenHarness mimeType="video/mp4" />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (video) video.currentTime = 12.5;

    fireEvent.click(
      screen.getByRole("button", { name: coreMessagesByLocale.en.airapp.enterFullscreen }),
    );

    await waitFor(() =>
      expect(container.querySelector('[data-file-fullscreen="true"]')).not.toBeNull(),
    );
    expect(container.querySelector("video")).toBe(video);
    expect((container.querySelector("video") as HTMLVideoElement).currentTime).toBe(12.5);
    expect(window.location.search).toContain("demo=node-types");
    expect(window.location.search).toContain("fullscreen=1");

    fireEvent.click(
      screen.getByRole("button", { name: coreMessagesByLocale.en.airapp.exitFullscreen }),
    );
    await waitFor(() =>
      expect(container.querySelector('[data-file-fullscreen="true"]')).toBeNull(),
    );
    expect(container.querySelector("video")).toBe(video);
    expect(window.location.search).toBe("?demo=node-types");
  });

  it("keeps Side Panel fullscreen local and preserves the current URL", async () => {
    window.history.replaceState(null, "", "/dashboard/home?demo=node-types");
    const { container } = render(<LocalFullscreenHarness mimeType="image/svg+xml" />);
    const image = container.querySelector("img");

    fireEvent.click(
      screen.getByRole("button", { name: coreMessagesByLocale.en.airapp.enterFullscreen }),
    );
    await waitFor(() =>
      expect(container.querySelector('[data-file-fullscreen="true"]')).not.toBeNull(),
    );
    expect(container.querySelector("img")).toBe(image);
    expect(window.location.pathname).toBe("/dashboard/home");
    expect(window.location.search).toBe("?demo=node-types");
  });

  it.each([
    ["audio/mpeg", "audio"],
    ["application/zip", "a"],
  ])("does not offer fullscreen for %s", (mimeType, selector) => {
    const { container } = render(<LocalFullscreenHarness mimeType={mimeType} />);

    expect(container.querySelector(selector)).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: coreMessagesByLocale.en.airapp.enterFullscreen }),
    ).toBeNull();
  });

  it("clears an unsupported deep-link fullscreen request", async () => {
    window.history.replaceState(null, "", "/dashboard/file?demo=node-types&fullscreen=1");
    const { container } = render(<UrlFullscreenHarness mimeType="audio/mpeg" />);

    await waitFor(() => expect(window.location.search).toBe("?demo=node-types"));
    expect(container.querySelector('[data-file-fullscreen="true"]')).toBeNull();
    expect(
      screen.queryByRole("button", { name: coreMessagesByLocale.en.airapp.exitFullscreen }),
    ).toBeNull();
  });
});
