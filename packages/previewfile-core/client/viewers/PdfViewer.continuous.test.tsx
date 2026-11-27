import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PdfViewer from "./PdfViewer";

const fixture = vi.hoisted(() => ({
  count: 3,
  failPage: 0,
  failures: new Set<number>(),
  deferMetadata: false,
  metadataCalls: [] as number[],
  resolveMetadata: new Map<number, () => void>(),
}));

vi.mock("react-pdf", async () => {
  const { useEffect, useMemo } = await import("react");
  const geometry = (number: number) =>
    number % 2 === 0 ? { width: 1200, height: 600 } : { width: 600, height: 1000 };
  return {
    pdfjs: { GlobalWorkerOptions: {} },
    Document: ({
      children,
      onLoadSuccess,
      className,
    }: {
      children: ReactNode;
      className?: string;
      onLoadSuccess: (value: unknown) => void;
    }) => {
      const document = useMemo(
        () => ({
          numPages: fixture.count,
          getPage: async (number: number) => {
            fixture.metadataCalls.push(number);
            if (fixture.deferMetadata) {
              await new Promise<void>((resolve) => {
                fixture.resolveMetadata.set(number, resolve);
              });
            }
            return { getViewport: () => geometry(number) };
          },
        }),
        [],
      );
      useEffect(() => onLoadSuccess(document), [document]);
      return <div className={className}>{children}</div>;
    },
    Page: ({
      pageNumber,
      scale,
      onRenderError,
    }: {
      pageNumber: number;
      scale: number;
      onRenderError?: (error: Error) => void;
    }) => {
      useEffect(() => {
        if (fixture.failPage === pageNumber && !fixture.failures.has(pageNumber)) {
          fixture.failures.add(pageNumber);
          onRenderError?.(new Error("Could not render"));
        }
      }, [pageNumber, onRenderError]);
      return <canvas data-testid="pdf-page" data-page={pageNumber} data-scale={scale} />;
    },
  };
});

describe("continuous PDF reading with react-window", () => {
  let width: number;
  let height: number;
  const observers = new Set<() => void>();
  const viewport = () => {
    const element = document.querySelector<HTMLElement>("[data-pdf-continuous-viewport]");
    if (!element) throw new Error("Missing PDF viewport");
    return element;
  };
  const currentPage = () => Number((screen.getByRole("spinbutton") as HTMLInputElement).value);
  const show = () =>
    render(
      <PdfViewer
        fileName="report.pdf"
        fileUrl="/report.pdf"
        fitToContainer
        pdfScrollMode="continuous"
      />,
    );

  beforeEach(() => {
    width = 800;
    height = 600;
    fixture.count = 3;
    fixture.failPage = 0;
    fixture.failures.clear();
    fixture.deferMetadata = false;
    fixture.metadataCalls.length = 0;
    fixture.resolveMetadata.clear();
    observers.clear();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function () {
      return this.hasAttribute("data-pdf-continuous-viewport") ? width : width + 32;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function () {
      return this.hasAttribute("data-pdf-continuous-viewport") ? height : height + 32;
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(
          private callback: (
            values: { target: Element; contentRect: { width: number; height: number } }[],
          ) => void,
        ) {}
        observe(element: HTMLElement) {
          if (!element.hasAttribute("data-pdf-continuous-viewport")) {
            element.style.padding = "16px";
          }
          const resize = () => this.callback([{ target: element, contentRect: { width, height } }]);
          observers.add(resize);
          resize();
        }
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows adjacent pages with a gap and synchronizes the toolbar while scrolling", async () => {
    show();
    await waitFor(() => expect(screen.getAllByTestId("pdf-page")).toHaveLength(3));
    expect(document.querySelector('[data-pdf-page-row="2"]')).toHaveStyle({
      transform: "translateY(612px)",
    });
    fireEvent.scroll(viewport(), { target: { scrollTop: 500 } });
    expect(currentPage()).toBe(2);
    expect(viewport().scrollTop).toBe(500);
    expect(screen.getByText("67%")).toBeVisible();
    fireEvent.scroll(viewport(), { target: { scrollTop: 0 } });
    expect(currentPage()).toBe(1);
  });

  it("uses buttons and the page input to position existing rows instead of replacing the document", async () => {
    show();
    await waitFor(() => expect(screen.getAllByTestId("pdf-page")).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(viewport().scrollTop).toBe(612);
    expect(currentPage()).toBe(2);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } });
    expect(viewport().scrollTop).toBe(1024);
    expect(currentPage()).toBe(3);
    expect(screen.getAllByTestId("pdf-page")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(viewport().scrollTop).toBe(612);
  });

  it("preserves the reading page and its relative position when zoom or the viewport changes", async () => {
    show();
    await waitFor(() => expect(screen.getAllByTestId("pdf-page")).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Fit Width" }));
    fireEvent.scroll(viewport(), { target: { scrollTop: 300 } });
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(viewport().scrollTop).toBeCloseTo(356.25);
    expect(currentPage()).toBe(1);
    const manualPosition = viewport().scrollTop;
    act(() => {
      width = 600;
      height = 400;
      for (const resize of observers) resize();
    });
    expect(viewport().scrollTop).toBeCloseTo(manualPosition);
    expect(currentPage()).toBe(1);
  });

  it("mounts only a small set of canvases for a long document and can jump to its last page", async () => {
    fixture.count = 100;
    show();
    await waitFor(() => expect(screen.getAllByTestId("pdf-page").length).toBeGreaterThan(0));
    expect(screen.getAllByTestId("pdf-page").length).toBeLessThan(10);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "100" } });
    fireEvent.scroll(viewport());
    await waitFor(() =>
      expect(screen.getAllByTestId("pdf-page").some((page) => page.dataset.page === "100")).toBe(
        true,
      ),
    );
    expect(currentPage()).toBe(100);
    expect(screen.getAllByTestId("pdf-page").length).toBeLessThan(10);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("keeps the document bottom through fullscreen resize and zoom, until the reader scrolls away", async () => {
    fixture.count = 100;
    width = 350;
    height = 500;
    show();
    await waitFor(() => expect(screen.getAllByTestId("pdf-page").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "100" } });
    fireEvent.scroll(viewport());
    await waitFor(() =>
      expect(screen.getAllByTestId("pdf-page").some((page) => page.dataset.page === "100")).toBe(
        true,
      ),
    );
    const pageLayout = (number: number) => {
      const row = document.querySelector<HTMLElement>(`[data-pdf-page-row="${number}"]`);
      const surface = row?.querySelector<HTMLElement>("[data-pdf-page-surface]");
      if (!row || !surface) throw new Error(`Page ${number} is not mounted`);
      return {
        top: Number.parseFloat(row.style.transform.replace("translateY(", "")),
        height: Number.parseFloat(surface.style.height),
      };
    };
    const documentBottom = () => {
      const last = pageLayout(100);
      return last.top + last.height;
    };
    // jsdom does not clamp scrollTop as a browser does when jumping to the last row.
    fireEvent.scroll(viewport(), {
      target: { scrollTop: Math.max(0, documentBottom() - height) },
    });
    expect(currentPage()).toBe(100);
    expect(viewport().scrollTop).toBeLessThan(pageLayout(100).top);

    act(() => {
      width = 1366;
      height = 700;
      for (const resize of observers) resize();
    });
    fireEvent.scroll(viewport());
    expect(currentPage()).toBe(100);
    expect(viewport().scrollTop).toBeCloseTo(documentBottom() - height);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.scroll(viewport());
    expect(currentPage()).toBe(100);
    expect(viewport().scrollTop).toBeCloseTo(documentBottom() - height);

    const previous = pageLayout(99);
    fireEvent.scroll(viewport(), { target: { scrollTop: previous.top + 50 } });
    expect(currentPage()).toBe(99);
    const readingPosition = viewport().scrollTop;
    act(() => {
      width = 800;
      height = 400;
      for (const resize of observers) resize();
    });
    expect(viewport().scrollTop).toBeCloseTo(readingPosition);
    expect(currentPage()).toBe(99);
  });

  it("prioritizes a page reached by dragging the scroll position before the background sequence", async () => {
    fixture.count = 100;
    fixture.deferMetadata = true;
    show();
    await waitFor(() => expect(fixture.metadataCalls).toEqual([1, 2]));
    fireEvent.scroll(viewport(), { target: { scrollTop: 99 * 612 } });
    expect(currentPage()).toBe(100);
    const finishFirst = fixture.resolveMetadata.get(1);
    if (!finishFirst) throw new Error("First page was not requested");
    await act(async () => finishFirst());
    expect(fixture.metadataCalls).toEqual([1, 2, 100]);
    const finishLast = fixture.resolveMetadata.get(100);
    if (!finishLast) throw new Error("Visible page was not prioritized");
    await act(async () => finishLast());
    await waitFor(() =>
      expect(screen.getAllByTestId("pdf-page").some((page) => page.dataset.page === "100")).toBe(
        true,
      ),
    );
  });

  it("retries a failed page without replacing the other readable pages", async () => {
    fixture.failPage = 2;
    show();
    await screen.findByRole("alert");
    expect(screen.getAllByTestId("pdf-page").some((page) => page.dataset.page === "1")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getAllByTestId("pdf-page").some((page) => page.dataset.page === "2")).toBe(true);
  });

  it("keeps single-page documents bounded and starts a new attachment from its first page", async () => {
    const result = show();
    await waitFor(() => expect(screen.getAllByTestId("pdf-page")).toHaveLength(3));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fixture.count = 1;
    result.rerender(
      <PdfViewer
        fileName="another.pdf"
        fileUrl="/another.pdf"
        fitToContainer
        pdfScrollMode="continuous"
      />,
    );
    await waitFor(() => expect(screen.getAllByTestId("pdf-page")).toHaveLength(1));
    expect(currentPage()).toBe(1);
    expect(viewport().scrollTop).toBe(0);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fit Page", pressed: true })).toBeVisible();
  });
});
