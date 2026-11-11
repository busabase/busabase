import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileFetchService } from "../file-fetch";
import { ErrorState } from "../viewers/ErrorState";
import { EmbeddedFileViewer } from "./index";

const service = FileFetchService.getInstance();

beforeEach(() => service.clearCache());
afterEach(() => {
  cleanup();
  service.clearCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("embedded viewer recovery", () => {
  it.each(["HTTP failure", "cached invalid UTF-8"])(
    "retries a real subtitle viewer after %s without reloading the workspace",
    async (failure) => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(new Response("unrelated attachment"))
        .mockResolvedValueOnce(
          failure === "HTTP failure"
            ? new Response("temporarily unavailable", { status: 503 })
            : new Response(new Uint8Array([255])),
        )
        .mockResolvedValueOnce(
          new Response("1\n00:00:00,000 --> 00:00:02,000\nRecovered subtitle 你好\n"),
        );
      vi.stubGlobal("fetch", fetcher);
      await service.fetchAsArrayBuffer("/unrelated.bin");
      render(
        <div>
          <input aria-label="Record draft" defaultValue="unsaved record" />
          <EmbeddedFileViewer
            fileName="captions.srt"
            mimeType="application/x-subrip"
            url="/retry.srt"
          />
        </div>,
      );
      const draft = screen.getByRole("textbox", { name: "Record draft" });
      await screen.findByRole("button", { name: "Try Again" });
      expect(service.isCached("/retry.srt")).toBe(failure !== "HTTP failure");
      fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
      await waitFor(() => expect(screen.getByText("Recovered subtitle 你好")).toBeInTheDocument());
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        "/unrelated.bin",
        "/retry.srt",
        "/retry.srt",
      ]);
      expect(service.isCached("/unrelated.bin")).toBe(true);
      expect(screen.getByRole("textbox", { name: "Record draft" })).toBe(draft);
      expect(draft).toHaveValue("unsaved record");
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  it("keeps the standalone error callback when no host recovery is present", () => {
    const retry = vi.fn();
    render(<ErrorState error="failed" onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
