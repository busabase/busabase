// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { TEXT_ATTACHMENT_MAX_BYTES } from "../utils/text-attachment";
import { AttachmentValuePreview } from "./attachment-value-preview";

const file = (id: string, overrides = {}) => ({
  id,
  url: `https://example.com/${id}.md`,
  fileName: `${id}.md`,
  mimeType: "application/octet-stream",
  size: 80,
  ...overrides,
});
const response = (text: string) =>
  new Response(new TextEncoder().encode(text), {
    headers: { "content-type": "text/plain; charset=windows-1252" },
  });

const show = (files = [file("审计报告")]) =>
  render(
    <CoreI18nProvider locale="en">
      <AttachmentValuePreview value={files} />
    </CoreI18nProvider>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Markdown attachment dialog", () => {
  it("previews Chinese legacy bytes with tables, keeps literal source, and offers the original download", async () => {
    const source =
      "# 审计报告\n\n| 项目 | 结果 |\n| --- | --- |\n| 编码 🧪 | 正常 |\n\n<script>window.hacked=true</script>\n";
    const fetcher = vi.fn().mockResolvedValue(response(source));
    vi.stubGlobal("fetch", fetcher);
    show();
    fireEvent.click(screen.getByRole("link", { name: "审计报告.md" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(
      () => expect(within(dialog).getByRole("heading", { name: "审计报告" })).toBeTruthy(),
      { timeout: 10_000 },
    );
    expect(within(dialog).getByRole("table")).toBeTruthy();
    expect(within(dialog).getByText("编码 🧪")).toBeTruthy();
    expect(dialog.querySelector("script")).toBeNull();
    expect(within(dialog).getByRole("link", { name: "Download file" }).getAttribute("href")).toBe(
      "https://example.com/审计报告.md",
    );
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://example.com/审计报告.md");
    fireEvent.click(within(dialog).getByRole("button", { name: "Source" }));
    expect(within(dialog).queryByRole("table")).toBeNull();
    expect(dialog.textContent).toContain(source);
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    expect(within(dialog).getByRole("table")).toBeTruthy();
  });

  it("prefers the .md extension to an image MIME, uses the asset URL, and resets mode on every switch", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(response(url.includes("ast_first") ? "# 第一份" : "# 第二份")),
        ),
    );
    const { container } = show([
      file("first", { assetId: "ast_first", mimeType: "image/png", fileName: "first.MD" }),
      file("second"),
    ]);
    expect(container.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "first.MD" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByRole("heading", { name: "第一份" })).toBeTruthy(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Source" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "second.md" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("heading", { name: "第二份" })).toBeTruthy(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "first.MD" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("heading", { name: "第一份" })).toBeTruthy(),
    );
    expect(within(dialog).getByRole("link", { name: "Download file" }).getAttribute("href")).toBe(
      "/api/assets/ast_first/raw?download=1&filename=first.MD",
    );
  });

  it("shows loading, retries the same address after failure, and returns focus on close", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<Response>((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce(response("# 恢复成功"));
    vi.stubGlobal("fetch", fetcher);
    show([file("retry")]);
    const opener = screen.getByRole("link", { name: "retry.md" });
    fireEvent.click(opener);
    expect(screen.getByRole("status").textContent).toContain("Loading text");
    await act(async () => resolve(new Response("offline", { status: 503 })));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "恢复成功" })).toBeTruthy());
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "https://example.com/retry.md",
      "https://example.com/retry.md",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("does not show an old completion after switching and aborts reads when closed", async () => {
    let resolveOld!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<Response>((done) => {
          resolveOld = done;
        }),
      )
      .mockResolvedValueOnce(response("# 当前附件"));
    vi.stubGlobal("fetch", fetcher);
    show([file("slow"), file("current")]);
    fireEvent.click(screen.getByRole("link", { name: "slow.md" }));
    const oldSignal = fetcher.mock.calls[0]?.[1]?.signal as AbortSignal;
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "current.md" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "当前附件" })).toBeTruthy());
    expect(oldSignal.aborted).toBe(true);
    await act(async () => resolveOld(response("# 已过时")));
    expect(screen.queryByRole("heading", { name: "已过时" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect((fetcher.mock.calls[1]?.[1]?.signal as AbortSignal).aborted).toBe(true);
  });

  it.each([
    [new Uint8Array([0xff]), "not valid UTF-8"],
    [new Uint8Array([0xe4, 0xb8]), "not valid UTF-8"],
  ])("explains invalid encoding while leaving download available", async (bytes, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes)));
    show([file("invalid")]);
    fireEvent.click(screen.getByRole("link", { name: "invalid.md" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(message));
    expect(screen.queryByRole("button", { name: "Try Again" })).toBeNull();
    expect(screen.getByRole("link", { name: "Download file" })).toBeTruthy();
  });

  it("enforces stored size before fetching and keeps oversized files downloadable", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    show([file("large", { size: TEXT_ATTACHMENT_MAX_BYTES + 1 })]);
    fireEvent.click(screen.getByRole("link", { name: "large.md" }));
    expect(screen.getByRole("alert").textContent).toContain("1 MiB");
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Download file" })).toBeTruthy();
  });

  it("renders a useful empty state with the source switch still available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("")));
    show([file("empty")]);
    fireEvent.click(screen.getByRole("link", { name: "empty.md" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("empty"));
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getByRole("link", { name: "Download file" })).toBeTruthy();
  });
});

describe("plain-text and source attachment dialog", () => {
  it.each([
    ["notes.TXT", "application/octet-stream"],
    ["source.html", "image/png"],
    ["source.js", "application/javascript"],
    ["config.json", "application/json"],
    ["config.yaml", "application/yaml"],
  ])(
    "shows %s as inert text with exact whitespace and original download",
    async (fileName, mimeType) => {
      const content = "  中文 🧪\r\n\tindent\r\n\r\n<script>window.hacked=true</script>\r\n";
      const fetcher = vi.fn().mockResolvedValue(response(content));
      vi.stubGlobal("fetch", fetcher);
      const { container } = show([file("source", { fileName, mimeType })]);
      expect(container.querySelector("img")).toBeNull();
      fireEvent.click(screen.getByRole("link", { name: fileName }));
      const dialog = screen.getByRole("dialog");
      await waitFor(() =>
        expect(screen.getByTestId("attachment-text-preview").getAttribute("data-text-state")).toBe(
          "ready",
        ),
      );
      const source = within(dialog).queryByRole("button", { name: "Source" });
      if (fileName.toLowerCase().endsWith(".txt")) {
        expect(source).toBeNull();
      } else {
        expect(source).toBeTruthy();
        fireEvent.click(source as HTMLElement);
        expect(source?.getAttribute("aria-pressed")).toBe("true");
      }
      expect(screen.getByTestId("attachment-text-content").textContent).toBe(content);
      expect(dialog.querySelector("script")).toBeNull();
      expect(within(dialog).getByRole("link", { name: "Download file" })).toBeTruthy();
      expect(within(dialog).getByRole("link", { name: "Open in new tab" })).toBeTruthy();
    },
  );

  it("uses text states for an empty TXT instead of Markdown controls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("")));
    show([file("empty", { fileName: "empty.txt", mimeType: "text/plain" })]);
    fireEvent.click(screen.getByRole("link", { name: "empty.txt" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("This text file is empty."),
    );
    expect(screen.getByTestId("attachment-text-content").textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
  });

  it("reads a MIME-only TXT and switches safely between text and Markdown", async () => {
    let resolveOld!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<Response>((done) => {
          resolveOld = done;
        }),
      )
      .mockResolvedValueOnce(response("# 当前 Markdown"))
      .mockResolvedValueOnce(response("当前纯文本\t\r\n"));
    vi.stubGlobal("fetch", fetcher);
    show([
      file("text", { fileName: "download", mimeType: "Text/Plain; charset=utf-8" }),
      file("markdown"),
    ]);
    fireEvent.click(screen.getByRole("link", { name: "download" }));
    const oldSignal = fetcher.mock.calls[0]?.[1]?.signal as AbortSignal;
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "markdown.md" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "当前 Markdown" })).toBeTruthy(),
    );
    expect(oldSignal.aborted).toBe(true);
    await act(async () => resolveOld(response("obsolete source")));
    expect(screen.queryByText("obsolete source")).toBeNull();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "download" }));
    await waitFor(() =>
      expect(screen.getByTestId("attachment-text-content").textContent).toBe("当前纯文本\t\r\n"),
    );
  });

  it("does not fetch an unsafe text URL", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    show([
      file("unsafe", {
        fileName: "unsafe.txt",
        mimeType: "text/plain",
        url: "javascript:alert(1)",
      }),
    ]);
    expect(screen.queryByRole("link", { name: "unsafe.txt" })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
