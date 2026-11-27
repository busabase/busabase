// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  TEXT_ATTACHMENT_MAX_BYTES,
  TEXT_ATTACHMENT_TIMEOUT_MS,
} from "previewfile-core/client/text-preview";
import { detectFileType, FileType } from "previewfile-core/utils/file-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { HTML_DOCUMENT_SANDBOX } from "../helpers/html";
import { AttachmentViewer } from "./attachment-viewer";
import type { HostFileViewerFile } from "./file-viewer-slot";

const file: HostFileViewerFile = {
  name: "report.HTML",
  mimeType: "application/octet-stream",
  url: "/report.html",
  size: 500,
};
const source =
  "<!doctype html><html><head><style>h1{color:red}</style></head><body><h1>报告 🧪</h1>" +
  "<button onclick=\"document.querySelector('h1').textContent='Updated'\">Update</button>" +
  "<script>window.reportLoaded=true</script></body></html>";
const response = (content: string) =>
  new Response(new TextEncoder().encode(content), {
    headers: { "content-type": "text/html; charset=windows-1252" },
  });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("HTML attachment viewer", () => {
  it.each([
    file,
    { ...file, name: "report.htm", mimeType: "image/png" },
    { ...file, name: "download", mimeType: "Text/Html; charset=utf-8" },
  ])("previews $name with the HTML field sandbox and keeps literal source", async (attachment) => {
    const fetcher = vi.fn().mockResolvedValue(response(source));
    vi.stubGlobal("fetch", fetcher);
    const { container } = render(<AttachmentViewer file={attachment} />);
    const frame = await screen.findByTestId("attachment-html-frame");
    expect(frame.getAttribute("srcdoc")).toContain("<style>h1{color:red}</style>");
    expect(frame.getAttribute("srcdoc")).toContain("<h1>报告 🧪</h1>");
    expect(frame.getAttribute("srcdoc")).toContain("<script>window.reportLoaded=true</script>");
    expect(screen.getByTestId("attachment-html-viewer")).toBeTruthy();
    expect(frame.getAttribute("sandbox")).toBe(HTML_DOCUMENT_SANDBOX);
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(container.querySelector("script")).toBeNull();
    expect(
      (window as unknown as Record<symbol, unknown>)[Symbol.for("busabase.html-history-guard")],
    ).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.queryByTestId("attachment-html-frame")).toBeNull();
    expect(frame.isConnected).toBe(false);
    expect(screen.getByTestId("attachment-text-content").textContent).toBe(source);
    expect(screen.getByTestId("attachment-text-content").getAttribute("data-language")).toBe(
      "html",
    );
    expect(screen.queryByTestId("attachment-html-source-fallback")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("button[onclick]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const nextFrame = screen.getByTestId("attachment-html-frame");
    expect(nextFrame).not.toBe(frame);
    expect(nextFrame.getAttribute("srcdoc")).toContain("<h1>报告 🧪</h1>");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(detectFileType({ fileName: "report.html", mimeType: "text/html" })).toBe(FileType.CODE);
  });

  it.each(["\n", "\r\n"])(
    "highlights inert HTML with %j line endings while retaining indentation and blank lines",
    async (lineEnding) => {
      const content = [
        "  <!doctype html>",
        "<html>",
        "",
        '\t<body data-label="报告 🧪 &amp; more">  text  </body>',
        "<script>window.htmlSourceExecuted = true</script>",
        "</html>",
        "",
      ].join(lineEnding);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(content)));
      const { container } = render(<AttachmentViewer file={file} />);
      await screen.findByTestId("attachment-html-frame");
      fireEvent.click(screen.getByRole("button", { name: "Source" }));
      const highlighted = screen.getByTestId("attachment-text-content");
      const rawLines = Array.from(highlighted.querySelectorAll("code > span"));
      expect(rawLines.map((line) => (line.textContent === "\n" ? "" : line.textContent))).toEqual(
        content.split("\n"),
      );
      await waitFor(() =>
        expect(highlighted.querySelector('code > span > span[style*="#"]')).toBeTruthy(),
      );
      const lines = Array.from(highlighted.querySelectorAll("code > span"));
      expect(lines.map((line) => (line.textContent === "\n" ? "" : line.textContent))).toEqual(
        content.replaceAll("\r\n", "\n").split("\n"),
      );
      expect(lines.every((line) => line.className.includes("[counter-increment:line]"))).toBe(true);
      expect(container.querySelector("script")).toBeNull();
      expect((window as unknown as Record<string, unknown>).htmlSourceExecuted).toBeUndefined();
      expect(screen.queryByTestId("attachment-html-frame")).toBeNull();
    },
  );

  it.each([
    ["character", `<p>${"x".repeat(120_000 - 7)}</p>`, false],
    ["character", `<p>${"x".repeat(120_001 - 7)}</p>`, true],
    ["line", "\n".repeat(1999), false],
    ["line", "\n".repeat(2000), true],
  ])(
    "uses the exact %s highlighting budget without omitting oversized source",
    async (_budget, content, fallback) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(content)));
      render(
        <CoreI18nProvider locale="zh-CN">
          <AttachmentViewer file={file} />
        </CoreI18nProvider>,
      );
      await screen.findByTestId("attachment-html-frame");
      const messages = coreMessagesByLocale["zh-CN"];
      fireEvent.click(screen.getByRole("button", { name: messages.recordView.sourceTab }));
      const rendered = screen.getByTestId("attachment-text-content");
      if (fallback) {
        expect(rendered.tagName).toBe("PRE");
        expect(rendered.textContent).toBe(content);
        expect(rendered.querySelector("code")).toBeNull();
        const notice = screen.getByTestId("attachment-html-source-fallback");
        expect(notice.textContent).toBe(messages.richNodes.htmlSourcePlainText);
        expect(rendered.contains(notice)).toBe(false);
      } else {
        expect(rendered.getAttribute("data-language")).toBe("html");
        expect(rendered.querySelector("code")).toBeTruthy();
        expect(screen.queryByTestId("attachment-html-source-fallback")).toBeNull();
      }
      fireEvent.click(screen.getByRole("button", { name: messages.recordView.preview }));
      expect(screen.getByTestId("attachment-html-frame").getAttribute("srcdoc")).toContain(content);
      expect(screen.queryByTestId("attachment-html-source-fallback")).toBeNull();
    },
  );

  it("keeps recognized non-HTML extensions on their existing viewer", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { container } = render(
      <AttachmentViewer file={{ ...file, name: "report.png", mimeType: "text/html" }} />,
    );
    expect(screen.queryByTestId("attachment-html-viewer")).toBeNull();
    expect(container.querySelector('[data-previewfile-type="image"]')).toBeTruthy();
    expect(container.querySelector('[data-asset-preview="host"]')).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("localizes the preview and source controls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(source)));
    render(
      <CoreI18nProvider locale="zh-CN">
        <AttachmentViewer file={file} />
      </CoreI18nProvider>,
    );
    await screen.findByTestId("attachment-html-frame");
    const messages = coreMessagesByLocale["zh-CN"].recordView;
    expect(
      screen.getByRole("button", { name: messages.preview }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: messages.sourceTab }));
    expect(screen.getByTestId("attachment-text-content").textContent).toBe(source);
  });

  it("removes the previous document on switch and resets source mode even for identical URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => response(source)),
    );
    const { rerender, unmount } = render(<AttachmentViewer file={file} />);
    const oldFrame = await screen.findByTestId("attachment-html-frame");
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    rerender(<AttachmentViewer file={{ ...file, name: "second.html" }} />);
    const secondFrame = await screen.findByTestId("attachment-html-frame");
    expect(oldFrame.isConnected).toBe(false);
    expect(secondFrame).not.toBe(oldFrame);
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    rerender(<AttachmentViewer file={{ ...file, name: "image.png", mimeType: "image/png" }} />);
    expect(secondFrame.isConnected).toBe(false);
    expect(screen.queryByTestId("attachment-html-viewer")).toBeNull();
    rerender(<AttachmentViewer file={file} />);
    await screen.findByTestId("attachment-html-frame");
    unmount();
    render(<AttachmentViewer file={file} />);
    await screen.findByTestId("attachment-html-frame");
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("aborts obsolete reads, ignores late responses and cancels the current read on unmount", async () => {
    let finishOld!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          finishOld = resolve;
        }),
      )
      .mockResolvedValueOnce(response("<h1>Current report</h1>"));
    vi.stubGlobal("fetch", fetcher);
    const { rerender, unmount } = render(<AttachmentViewer file={file} />);
    expect(screen.getByRole("status").textContent).toContain("Loading text");
    const oldSignal = fetcher.mock.calls[0]?.[1]?.signal as AbortSignal;
    rerender(<AttachmentViewer file={{ ...file, url: "/current.html" }} />);
    const frame = await screen.findByTestId("attachment-html-frame");
    expect(oldSignal.aborted).toBe(true);
    await act(async () => finishOld(response("<h1>Obsolete report</h1>")));
    expect(frame.getAttribute("srcdoc")).toContain("Current report");
    expect(frame.getAttribute("srcdoc")).not.toContain("Obsolete report");
    unmount();
    expect((fetcher.mock.calls[1]?.[1]?.signal as AbortSignal).aborted).toBe(true);
  });

  it("retries a failed read at the original address", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(response(source));
    vi.stubGlobal("fetch", fetcher);
    render(<AttachmentViewer file={file} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load");
    expect(screen.queryByTestId("attachment-html-frame")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    await screen.findByTestId("attachment-html-frame");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([file.url, file.url]);
  });

  it("times out a stalled read, offers retry and cancels the retry on unmount", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const { unmount } = render(<AttachmentViewer file={file} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEXT_ATTACHMENT_TIMEOUT_MS);
    });
    expect(screen.getByRole("alert").textContent).toContain("too long");
    expect((fetcher.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(screen.getByRole("status").textContent).toContain("Loading text");
    unmount();
    expect((fetcher.mock.calls[1]?.[1]?.signal as AbortSignal).aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects oversized stored metadata before making a request", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<AttachmentViewer file={{ ...file, size: TEXT_ATTACHMENT_MAX_BYTES + 1 }} />);
    expect(screen.getByRole("alert").textContent).toContain("1 MiB");
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Try Again" })).toBeNull();
  });

  it.each([
    [new Uint8Array([0xff]), "not valid UTF-8"],
    [new Uint8Array([0xe4, 0xb8]), "not valid UTF-8"],
    [new Uint8Array(TEXT_ATTACHMENT_MAX_BYTES + 1), "1 MiB"],
  ])("rejects invalid or oversized response bytes", async (bytes, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes)));
    render(<AttachmentViewer file={file} />);
    expect((await screen.findByRole("alert")).textContent).toContain(message);
    expect(screen.queryByTestId("attachment-html-frame")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try Again" })).toBeNull();
  });

  it("shows empty content with both modes still available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("")));
    render(<AttachmentViewer file={file} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("empty"));
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getByTestId("attachment-text-content").querySelector("code")?.textContent).toBe(
      "\n",
    );
    expect(screen.queryByTestId("attachment-html-frame")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByTestId("attachment-html-frame")).toBeTruthy();
  });
});
