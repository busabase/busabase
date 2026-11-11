import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import AudioViewer from "./AudioViewer";

const LOADING = "Loading audio...";
const originalSetAttribute = HTMLAudioElement.prototype.setAttribute;

afterEach(() => {
  HTMLAudioElement.prototype.setAttribute = originalSetAttribute;
  cleanup();
});

describe("AudioViewer", () => {
  it("shows the player once the audio's metadata loads", () => {
    const { container } = render(<AudioViewer fileUrl="/a.mp3" fileName="a.mp3" />);
    expect(screen.getByText(LOADING)).toBeInTheDocument();

    fireEvent.loadedMetadata(container.querySelector("audio") as HTMLAudioElement);

    expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
  });

  it("shows the player when a fast source loads before effects run", async () => {
    // A blob or cached file can report its metadata right after src is set,
    // before React runs effects (outside act they run in a later task).
    HTMLAudioElement.prototype.setAttribute = function (name: string, value: string) {
      originalSetAttribute.call(this, name, value);
      if (name === "src") queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
    };
    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previous = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      root.render(<AudioViewer fileUrl="blob:tone" fileName="tone.wav" />);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(host.querySelector("audio")).not.toBeNull();
      expect(host.textContent).not.toContain(LOADING);
    } finally {
      root.unmount();
      host.remove();
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previous;
    }
  });

  it("shows the player when the metadata arrived before React listened", () => {
    // Rendered concurrently, the element can load between render and commit;
    // React drops that event, but the element still knows it has loaded.
    const readyState = vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(1);
    try {
      render(<AudioViewer fileUrl="blob:tone" fileName="tone.wav" />);

      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    } finally {
      readyState.mockRestore();
    }
  });

  it("loads again when another file is shown", () => {
    const { container, rerender } = render(<AudioViewer fileUrl="/a.mp3" fileName="a.mp3" />);
    fireEvent.loadedMetadata(container.querySelector("audio") as HTMLAudioElement);

    act(() => rerender(<AudioViewer fileUrl="/b.mp3" fileName="b.mp3" />));

    expect(screen.getByText(LOADING)).toBeInTheDocument();
  });
});
