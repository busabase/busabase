// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { usePreviewFullscreen } from "../../dashboard/components/preview-fullscreen";
import { AirAppFileViewer } from "./AirAppDetailView";

function Providers({ children }: { children: ReactNode }) {
  return (
    <Router>
      <CoreI18nProvider locale="en">{children}</CoreI18nProvider>
    </Router>
  );
}

function FileViewerHarness() {
  const fullscreenState = usePreviewFullscreen();
  const sourceRef = useRef<HTMLPreElement>(null);

  return (
    <AirAppFileViewer fullscreenState={fullscreenState} openPath="public/hero.css">
      <pre data-airapp-source ref={sourceRef}>
        {".hero{".padEnd(4_000, "x")}
      </pre>
    </AirAppFileViewer>
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("AirAppFileViewer", () => {
  it("keeps long source lines in its own scrollable, shrinkable region", () => {
    const { container } = render(
      <Providers>
        <FileViewerHarness />
      </Providers>,
    );

    const scrollRegion = container.querySelector<HTMLElement>("[data-airapp-file-content]");
    const fullscreenBody = container.querySelector<HTMLElement>("[data-preview-fullscreen-body]");

    expect(scrollRegion?.classList.contains("min-w-0")).toBe(true);
    expect(scrollRegion?.classList.contains("overflow-auto")).toBe(true);
    expect(scrollRegion?.classList.contains("overscroll-contain")).toBe(true);
    expect(fullscreenBody?.classList.contains("min-w-0")).toBe(true);
  });

  it("enters and leaves a local fullscreen reader without remounting the source or changing the URL", async () => {
    window.history.replaceState(null, "", "/airapp/demo?keep=1");
    const { container } = render(
      <Providers>
        <FileViewerHarness />
      </Providers>,
    );
    const messages = coreMessagesByLocale.en;
    const source = container.querySelector<HTMLPreElement>("[data-airapp-source]");
    expect(source).not.toBeNull();
    if (!source) return;
    source.scrollLeft = 400;

    fireEvent.click(screen.getByRole("button", { name: messages.airapp.enterFullscreen }));

    await waitFor(() =>
      expect(container.querySelector('[data-airapp-files-fullscreen="true"]')).not.toBeNull(),
    );
    expect(container.querySelector("[data-airapp-source]")).toBe(source);
    expect(source.scrollLeft).toBe(400);
    expect(window.location.search).toBe("?keep=1");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(container.querySelector('[data-airapp-files-fullscreen="true"]')).toBeNull(),
    );
    expect(container.querySelector("[data-airapp-source]")).toBe(source);
    expect(window.location.search).toBe("?keep=1");

    fireEvent.click(screen.getByRole("button", { name: messages.airapp.enterFullscreen }));
    await waitFor(() =>
      expect(container.querySelector('[data-airapp-files-fullscreen="true"]')).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: messages.airapp.exitFullscreen }));
    await waitFor(() =>
      expect(container.querySelector('[data-airapp-files-fullscreen="true"]')).toBeNull(),
    );
  });
});
