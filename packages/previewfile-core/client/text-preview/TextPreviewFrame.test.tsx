import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextPreviewFrame } from "./TextPreviewFrame";
import { TEXT_ATTACHMENT_TIMEOUT_MS } from "./use-text-preview";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("shared text preview lifecycle", () => {
  it("recovers a stalled read after timeout and cancels the retried read on unmount", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const result = render(
      <TextPreviewFrame fileUrl="/stalled.txt" fileSize={1}>
        {(text) => <pre>{text}</pre>}
      </TextPreviewFrame>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading text");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEXT_ATTACHMENT_TIMEOUT_MS);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("too long");
    expect((fetcher.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading text");
    result.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect((fetcher.mock.calls[1]?.[1]?.signal as AbortSignal).aborted).toBe(true);
  });
});
