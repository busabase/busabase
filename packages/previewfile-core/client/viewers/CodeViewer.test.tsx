import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CodeViewer from "./CodeViewer";
import { ViewerLayoutProvider } from "./viewer-layout";

const { useFileFetchMock } = vi.hoisted(() => ({ useFileFetchMock: vi.fn() }));
vi.mock("../text-preview/use-text-preview", () => ({
  useTextAttachment: () => {
    const value = useFileFetchMock();
    return {
      state: value.error
        ? { status: "error", error: "failed" }
        : value.loading
          ? { status: "loading" }
          : { status: "ready", content: value.data ?? "" },
      retry: value.refetch,
    };
  },
}));
// kui's highlighter (shiki) is its own concern: here it is a block that shows what it was given.
vi.mock("kui/ai-elements/code-block", () => ({
  CodeBlock: ({ code, language }: { code: string; language: string }) => (
    <pre data-language={language}>{code}</pre>
  ),
}));

const file = (data: string | null, extra: Record<string, unknown> = {}) =>
  useFileFetchMock.mockReturnValue({
    data,
    loading: false,
    error: null,
    refetch: vi.fn(),
    ...extra,
  });

const show = (
  props: Partial<Parameters<typeof CodeViewer>[0]> = {},
  wrap?: (node: ReactNode) => ReactNode,
) => {
  const ui = (
    <CodeViewer
      fileName="main.py"
      fileUrl="https://example.test/main.py"
      mimeType="text/x-python"
      {...props}
    />
  );
  return render(wrap ? <>{wrap(ui)}</> : ui);
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("CodeViewer", () => {
  it("shows the file with the language its name says", () => {
    file("print('hi')");
    const { container } = show();
    const block = container.querySelector("pre");
    expect(block?.textContent).toBe("print('hi')");
    expect(block?.getAttribute("data-language")).toBe("python");
  });

  it("loads nothing from a CDN: no script is ever added to the page", () => {
    // It used to add Monaco's loader from jsDelivr, then cdnjs, then unpkg.
    const append = vi.spyOn(document.head, "appendChild");
    file("const a = 1;");
    show({ fileName: "a.ts", mimeType: "" });
    expect(append).not.toHaveBeenCalled();
    expect(document.querySelectorAll("script[src]")).toHaveLength(0);
  });

  it("says it is loading while the file is on its way", () => {
    file(null, { loading: true });
    show();
    expect(screen.getByText("Loading text…")).toBeInTheDocument();
  });

  it("says why when the file cannot be read", () => {
    file(null, { error: new Error("HTTP error! status: 404") });
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this file");
    expect(screen.queryByText("Loading text…")).toBeNull();
  });

  it("shows an empty file as an empty file, not as still loading", () => {
    file("");
    const { container } = show();
    expect(container.querySelector("pre")).not.toBeNull();
    expect(screen.queryByText("Loading text…")).toBeNull();
  });

  it("draws a very large file in part and says so", () => {
    file(Array.from({ length: 8000 }, (_, i) => `row ${i + 1}`).join("\n"));
    const { container } = show();
    expect(container.querySelectorAll("pre")[0]?.textContent?.split("\n")).toHaveLength(5000);
    expect(screen.getByText("Showing the first 5000 of 8000 lines.")).toBeInTheDocument();
  });

  it("does not say it for a file it draws whole", () => {
    file("one\ntwo");
    show();
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });

  it("offers the unchanged source when syntax highlighting limits its preview", () => {
    const content = `  中文 🧪\r\n\tindent\r\n${"x".repeat(300_001)}`;
    file(content);
    show({ fileName: "source.js", mimeType: "application/javascript" });
    expect(screen.getByTestId("attachment-text-content").textContent).not.toBe(content);
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getByTestId("attachment-text-content").textContent).toBe(content);
    expect(screen.getByRole("button", { name: "Source" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
  });

  it.each(["", "  中文 🧪\r\n\tindent\r\n\r\n"])(
    "preserves literal plain-text whitespace without source controls",
    (content) => {
      file(content);
      show({ fileName: "notes.txt", mimeType: "application/octet-stream" });
      expect(screen.getByTestId("attachment-text-content").textContent).toBe(content);
      expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
    },
  );

  it("shows the watermark", () => {
    file("x");
    show({ watermark: "CONFIDENTIAL" });
    expect(screen.getByText("CONFIDENTIAL")).toBeInTheDocument();
  });

  describe("a preview that may not be downloaded", () => {
    it("blocks the context menu, selection, dragging and copying out of it", () => {
      file("secret");
      const { container } = show({ noDownload: true });
      const frame = container.querySelector("[data-code-viewer]") as HTMLElement;
      // fireEvent returns false when a handler called preventDefault.
      expect(fireEvent.contextMenu(frame)).toBe(false);
      expect(fireEvent.copy(frame)).toBe(false);
      expect(fireEvent(frame, new Event("selectstart", { bubbles: true, cancelable: true }))).toBe(
        false,
      );
    });

    it("leaves them alone otherwise", () => {
      file("open");
      const { container } = show({ noDownload: false });
      const frame = container.querySelector("[data-code-viewer]") as HTMLElement;
      expect(fireEvent.contextMenu(frame)).toBe(true);
      expect(fireEvent.copy(frame)).toBe(true);
    });
  });

  describe("layout", () => {
    it("is a fixed-height frame on the standalone page", () => {
      file("x");
      const { container } = show();
      expect(container.firstElementChild?.className).toContain("h-[600px]");
    });

    it("fills the frame of a host that embeds it", () => {
      file("x");
      const { container } = show({}, (node) => (
        <ViewerLayoutProvider layout="fill">{node}</ViewerLayoutProvider>
      ));
      expect(container.firstElementChild?.className).toContain("h-full");
      // Never the height of a long file where the frame has none of its own.
      expect(container.firstElementChild?.className).toContain("max-h-screen");
      expect(container.firstElementChild?.className).not.toContain("h-[600px]");
    });
  });
});
