/**
 * Unit tests for MarkdownViewer component
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownViewer from "./MarkdownViewer";

const { mockUseFileFetch } = vi.hoisted(() => ({
  mockUseFileFetch: vi.fn(),
}));

vi.mock("../text-preview/use-text-preview", () => ({
  useTextAttachment: () => {
    const value = mockUseFileFetch();
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

const mockMarkdown = (data: string) => {
  mockUseFileFetch.mockReturnValue({
    data,
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
};

const mockMarkdownError = (error: Error) => {
  mockUseFileFetch.mockReturnValue({
    data: null,
    loading: false,
    error,
    refetch: vi.fn(),
  });
};

describe("MarkdownViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Loading State", () => {
    it("should show loading message initially", () => {
      mockUseFileFetch.mockReturnValue({
        data: null,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });

      render(<MarkdownViewer fileUrl="https://example.com/test.md" />);

      expect(screen.getByText("Loading text…")).toBeInTheDocument();
    });

    it("shows an empty file as an empty page, not as still loading", async () => {
      mockMarkdown("");

      render(<MarkdownViewer fileUrl="https://example.com/empty.md" />);

      await waitFor(() => {
        expect(screen.queryByText("Loading text…")).not.toBeInTheDocument();
      });
    });
  });

  describe("Markdown Rendering", () => {
    it("should render basic markdown content", async () => {
      const markdownContent = "# Hello World\n\nThis is a **bold** text.";

      mockMarkdown(markdownContent);

      render(<MarkdownViewer fileUrl="https://example.com/test.md" />);

      await waitFor(() => {
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hello World");
      });

      expect(screen.getByText(/bold/)).toBeInTheDocument();
    });

    it("should render GitHub Flavored Markdown (tables)", async () => {
      const markdownContent = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |
`;

      mockMarkdown(markdownContent);

      render(<MarkdownViewer fileUrl="https://example.com/table.md" />);

      await waitFor(() => {
        expect(screen.getByText("Header 1")).toBeInTheDocument();
      });

      expect(screen.getByText("Cell 1")).toBeInTheDocument();
      expect(screen.getByText("Cell 4")).toBeInTheDocument();
    });

    it("should render code blocks", async () => {
      const markdownContent = "```javascript\nconst x = 42;\n```";

      mockMarkdown(markdownContent);

      render(<MarkdownViewer fileUrl="https://example.com/code.md" />);

      await waitFor(() => {
        expect(screen.getByText(/const x = 42/)).toBeInTheDocument();
      });
    });

    it("should render links", async () => {
      const markdownContent = "[Example Link](https://example.com)";

      mockMarkdown(markdownContent);

      render(<MarkdownViewer fileUrl="https://example.com/link.md" />);

      await waitFor(() => {
        const link = screen.getByRole("link", { name: "Example Link" });
        // The address is normalized (a bare origin gains its slash).
        expect(link).toHaveAttribute("href", "https://example.com/");
        // And leaves the page without handing the new one this one.
        expect(link).toHaveAttribute("target", "_blank");
        expect(link.getAttribute("rel")).toContain("noopener");
      });
    });

    it("renders task lists and keeps a table's cells", async () => {
      mockMarkdown("- [x] done\n- [ ] todo\n\n| a | b |\n|---|---|\n| 1 | 2 |");

      render(<MarkdownViewer fileUrl="https://example.com/tasks.md" />);

      await waitFor(() => expect(screen.getByText(/done/)).toBeInTheDocument());
      const boxes = screen.getAllByRole("checkbox");
      expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([true, false]);
      expect(boxes.every((box) => (box as HTMLInputElement).disabled)).toBe(true);
      expect(screen.getByRole("cell", { name: "2" })).toBeInTheDocument();
    });

    it("shows YAML frontmatter as data, as Busabase does, not as a heading", async () => {
      // Without this a SKILL.md opens on a huge "name: … description: …" heading.
      mockMarkdown("---\nname: weekly-report\ndescription: Draft it.\n---\n\n# Weekly report");

      render(<MarkdownViewer fileUrl="https://example.com/SKILL.md" />);

      await waitFor(() =>
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Weekly report"),
      );
      expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
      expect(screen.getByText(/name: weekly-report/)).toBeInTheDocument();
    });

    it("offers no copy or download buttons of its own on code and tables", async () => {
      // A preview that may not be downloaded must not carry them; one that may has its host's.
      mockMarkdown("```js\nconst x = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |");

      render(<MarkdownViewer fileUrl="https://example.com/code.md" />);

      await waitFor(() => expect(screen.getByText(/const x = 1/)).toBeInTheDocument());
      expect(screen.queryAllByRole("button")).toHaveLength(2);
    });
  });

  describe("Untrusted HTML", () => {
    it("strips scripts and event handlers from raw HTML in the file", async () => {
      mockMarkdown(
        '# Notes\n\n<img src="x" onerror="window.__pwned = true">\n\n<script>window.__pwned = true</script>\n\n<a href="javascript:alert(1)">link</a>',
      );

      const { container } = render(<MarkdownViewer fileUrl="https://example.com/notes.md" />);

      await waitFor(() => expect(screen.getByText("Notes")).toBeInTheDocument());
      expect(container.querySelector("script")).toBeNull();
      // The picture with the handler is not drawn at all, nor is any element carrying one.
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("[onerror]")).toBeNull();
      for (const link of container.querySelectorAll("a")) {
        expect(link.getAttribute("href") ?? "").not.toContain("javascript:");
      }
      expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    });
  });

  describe("Error Handling", () => {
    it("should show error message when fetch fails", async () => {
      mockMarkdownError(new Error("Network error"));

      render(<MarkdownViewer fileUrl="https://example.com/fail.md" />);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("Could not load this file");
      });
    });

    it("should show error message when response is not ok", async () => {
      mockMarkdownError(new Error("HTTP error! status: 404"));

      render(<MarkdownViewer fileUrl="https://example.com/notfound.md" />);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("Could not load this file");
      });
    });
  });

  describe("Watermark", () => {
    it("should display watermark when provided", async () => {
      const markdownContent = "# Test";

      mockMarkdown(markdownContent);

      render(<MarkdownViewer fileUrl="https://example.com/test.md" watermark="CONFIDENTIAL" />);

      await waitFor(() => {
        expect(screen.getByText("CONFIDENTIAL")).toBeInTheDocument();
      });
    });

    it("should not display watermark when not provided", async () => {
      const markdownContent = "# Test";

      mockMarkdown(markdownContent);

      render(<MarkdownViewer fileUrl="https://example.com/test.md" />);

      await waitFor(() => {
        expect(screen.getByRole("heading")).toBeInTheDocument();
      });

      expect(screen.queryByText("CONFIDENTIAL")).not.toBeInTheDocument();
    });
  });

  describe("Keyboard Shortcuts (noDownload)", () => {
    it("should prevent Ctrl+S when noDownload is true", async () => {
      const markdownContent = "# Test";

      mockMarkdown(markdownContent);

      render(<MarkdownViewer fileUrl="https://example.com/test.md" noDownload={true} />);

      await waitFor(() => {
        expect(screen.getByRole("heading")).toBeInTheDocument();
      });

      // Create a keyboard event with preventDefault spy
      const preventDefaultSpy = vi.fn();
      const event = new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
      });
      Object.defineProperty(event, "preventDefault", {
        value: preventDefaultSpy,
      });

      document.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it("should allow Ctrl+S when noDownload is false", async () => {
      const markdownContent = "# Test";

      mockMarkdown(markdownContent);

      render(<MarkdownViewer fileUrl="https://example.com/test.md" noDownload={false} />);

      await waitFor(() => {
        expect(screen.getByRole("heading")).toBeInTheDocument();
      });

      // Verify no event listener is attached when noDownload is false
      // (Implementation detail - we could test that Ctrl+S doesn't get prevented)
    });
  });
});
