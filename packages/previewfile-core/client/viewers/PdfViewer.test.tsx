import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessagesProvider } from "../i18n";
import PdfViewer from "./PdfViewer";
import { ViewerLayoutProvider } from "./viewer-layout";

const pageRenders = vi.hoisted(() => [] as { page: number; scale: number; hidden: boolean }[]);

vi.mock("react-pdf", async () => {
  const { useEffect } = await import("react");
  const dimensions = [
    { width: 600, height: 1000 },
    { width: 1200, height: 600 },
    { width: 4000, height: 8000 },
  ];
  return {
    pdfjs: { GlobalWorkerOptions: {} },
    Document: ({
      children,
      onLoadSuccess,
    }: {
      children: ReactNode;
      onLoadSuccess: (document: { numPages: number }) => void;
    }) => {
      useEffect(() => {
        onLoadSuccess({ numPages: 3 });
      }, []);
      return <div>{children}</div>;
    },
    Page: ({
      pageNumber,
      scale,
      className,
      onLoadSuccess,
      renderTextLayer,
      renderAnnotationLayer,
    }: {
      pageNumber: number;
      scale: number;
      className?: string;
      onLoadSuccess?: (page: {
        pageNumber: number;
        getViewport: (options: { scale: number }) => { width: number; height: number };
      }) => void;
      renderTextLayer: boolean;
      renderAnnotationLayer: boolean;
    }) => {
      pageRenders.push({
        page: pageNumber,
        scale,
        hidden: className?.split(" ").includes("invisible") ?? false,
      });
      useEffect(() => {
        onLoadSuccess?.({
          pageNumber,
          getViewport: () => dimensions[pageNumber - 1],
        });
      }, [pageNumber, onLoadSuccess]);
      return (
        <canvas
          data-testid="pdf-page"
          data-page={pageNumber}
          data-scale={scale}
          data-text-layer={String(renderTextLayer)}
          data-annotation-layer={String(renderAnnotationLayer)}
        />
      );
    },
  };
});

describe("PdfViewer container fitting", () => {
  let width: number;
  let height: number;
  let resize: () => void;
  let observed: HTMLElement | undefined;
  const disconnect = vi.fn();
  const page = () => screen.getByTestId("pdf-page");
  const scale = () => Number(page().dataset.scale);
  const show = (props: { fitToContainer?: boolean; noDownload?: boolean } = {}) =>
    render(<PdfViewer fileName="report.pdf" fileUrl="/report.pdf" {...props} />);

  beforeEach(() => {
    width = 832;
    height = 632;
    observed = undefined;
    pageRenders.length = 0;
    disconnect.mockClear();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => height);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe(element: HTMLElement) {
          observed = element;
          element.style.padding = "16px";
          resize();
        }
        disconnect = disconnect;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("defaults to fit page using the scroll viewport excluding padding", () => {
    const { unmount } = show({ fitToContainer: true });
    expect(observed).toHaveClass("overflow-auto", "min-h-0");
    expect(scale()).toBeCloseTo(600 / 1000);
    expect(screen.getByRole("button", { name: "Fit Page" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Fit Width" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("60%")).toBeVisible();
    expect(page().style.transform).toBe("");
    expect(page().style.width).toBe("");
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("never paints a fitted page at the unfitted 100% scale", () => {
    show({ fitToContainer: true });
    expect(pageRenders.filter((render) => !render.hidden).map((render) => render.scale)).toEqual(
      pageRenders.filter((render) => !render.hidden).map(() => 0.6),
    );
    pageRenders.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(pageRenders.length).toBeGreaterThan(0);
    for (const render of pageRenders) {
      expect(render).toMatchObject({ page: 2, hidden: false });
      expect(render.scale).not.toBe(1);
    }
    expect(scale()).toBeCloseTo(800 / 1200);
  });

  it("fits the width explicitly and follows viewport and page changes", () => {
    show({ fitToContainer: true });
    fireEvent.click(screen.getByRole("button", { name: "Fit Width" }));
    expect(scale()).toBeCloseTo(800 / 600);
    expect(screen.getByRole("button", { name: "Fit Width", pressed: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Fit Page", pressed: false })).toBeVisible();
    act(() => {
      width = 432;
      height = 332;
      resize();
    });
    expect(scale()).toBeCloseTo(400 / 600);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(scale()).toBeCloseTo(400 / 1200);
    fireEvent.click(screen.getByRole("button", { name: "Fit Page" }));
    expect(scale()).toBeCloseTo(400 / 1200);
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(scale()).toBeCloseTo(300 / 1000);
  });

  it("uses compact topbar controls and an accessible shared fit group", () => {
    show({ fitToContainer: true });
    expect(screen.getByRole("group", { name: "Fit Width / Fit Page" })).toHaveClass(
      "bg-muted/60",
      "p-0.5",
    );
    expect(screen.getByRole("button", { name: "Fit Page" })).toHaveClass("h-7", "bg-card");
    for (const name of ["Previous page", "Next page", "Zoom in", "Zoom out", "Download"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("size-8", "shadow-none");
      expect(screen.getByRole("button", { name })).not.toHaveClass("border");
    }
    expect(screen.getByRole("spinbutton", { name: "Page 1 of 3" })).toHaveClass("h-8");
  });

  it("fits the whole page and recalculates for a smaller viewport without changing page", () => {
    show({ fitToContainer: true });
    fireEvent.click(screen.getByRole("button", { name: "Fit Page" }));
    expect(scale()).toBeCloseTo(0.6);
    act(() => {
      width = 432;
      height = 332;
      resize();
    });
    expect(scale()).toBeCloseTo(0.3);
    expect(page()).toHaveAttribute("data-page", "1");
    expect(screen.getByRole("button", { name: "Fit Page" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("uses the current page's dimensions when switching portrait and landscape pages", () => {
    show({ fitToContainer: true });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(page()).toHaveAttribute("data-page", "2");
    expect(scale()).toBeCloseTo(800 / 1200);
    fireEvent.click(screen.getByRole("button", { name: "Fit Page" }));
    expect(scale()).toBeCloseTo(800 / 1200);
    act(() => {
      height = 232;
      resize();
    });
    expect(scale()).toBeCloseTo(200 / 600);
    fireEvent.click(screen.getByRole("button", { name: "Fit Width" }));
    expect(scale()).toBeCloseTo(800 / 1200);
    expect(page()).toHaveAttribute("data-page", "2");
  });

  it("lets fitting go below the manual zoom floor for large pages", () => {
    show({ fitToContainer: true });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(scale()).toBeCloseTo(0.075);
    fireEvent.click(screen.getByRole("button", { name: "Fit Width" }));
    expect(scale()).toBeCloseTo(0.2);
    fireEvent.click(screen.getByRole("button", { name: "Fit Page" }));
    expect(scale()).toBeCloseTo(0.075);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(scale()).toBe(0.5);
    expect(screen.getByRole("button", { name: "Fit Page" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it.each(["Zoom in", "Zoom out"])("keeps manual %s across resize and page changes", (button) => {
    show({ fitToContainer: true });
    fireEvent.click(screen.getByRole("button", { name: "Fit Page" }));
    fireEvent.click(screen.getByRole("button", { name: button }));
    const manual = button === "Zoom in" ? 0.85 : 0.5;
    expect(scale()).toBeCloseTo(manual);
    act(() => {
      width = 432;
      height = 332;
      resize();
    });
    expect(scale()).toBeCloseTo(manual);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(page()).toHaveAttribute("data-page", "2");
    expect(scale()).toBeCloseTo(manual);
    fireEvent.click(screen.getByRole("button", { name: "Fit Width" }));
    expect(scale()).toBeCloseTo(400 / 1200);
  });

  it("keeps the legacy 100% default and manual bounds with no resize observer", () => {
    show();
    expect(scale()).toBe(1);
    expect(observed).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Fit Width" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fit Page" })).toBeNull();
    expect(screen.getByRole("button", { name: "Next page" })).toHaveClass("h-10", "w-10", "border");
    expect(screen.getByRole("button", { name: "Download" })).toHaveTextContent("Download");
    for (let step = 0; step < 10; step++) {
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    }
    expect(scale()).toBe(2.5);
    for (let step = 0; step < 10; step++) {
      fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    }
    expect(scale()).toBe(0.5);
  });

  it("changes pages through the labeled input without losing the fit mode", () => {
    show({ fitToContainer: true });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Page 1 of 3" }), {
      target: { value: "2" },
    });
    expect(page()).toHaveAttribute("data-page", "2");
    expect(scale()).toBeCloseTo(800 / 1200);
    expect(screen.getByRole("button", { name: "Fit Page", pressed: true })).toBeVisible();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Page 2 of 3" }), {
      target: { value: "4" },
    });
    expect(page()).toHaveAttribute("data-page", "2");
  });

  it.each([false, true])("keeps downloading available with fitToContainer=%s", (fitToContainer) => {
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    show({ fitToContainer });
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(download).toHaveBeenCalledOnce();
    expect(download.mock.instances[0]).toHaveAttribute("href", "/report.pdf");
    expect(download.mock.instances[0]).toHaveAttribute("download", "report.pdf");
  });

  it("keeps no-download text and annotation guards with a watermark", () => {
    render(
      <PdfViewer
        fileName="report.pdf"
        fileUrl="/report.pdf"
        fitToContainer
        noDownload
        watermark="Confidential"
      />,
    );
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(page()).toHaveAttribute("data-text-layer", "false");
    expect(page()).toHaveAttribute("data-annotation-layer", "false");
    expect(screen.getByText("Confidential")).toBeVisible();
  });

  it("keeps embedded text and annotation behavior when only download controls are hidden", () => {
    render(
      <ViewerLayoutProvider layout="fill">
        <PdfViewer fileName="report.pdf" fileUrl="/report.pdf" fitToContainer noDownload />
      </ViewerLayoutProvider>,
    );
    expect(page()).toHaveAttribute("data-text-layer", "true");
    expect(page()).toHaveAttribute("data-annotation-layer", "true");
  });

  it.each(["en", "zh-CN", "zh-TW", "ja", "ko", "pt", "de", "es", "fr", "vi"])(
    "provides a localized fit-page control for %s",
    (locale) => {
      render(
        <MessagesProvider locale={locale}>
          <PdfViewer fileName="report.pdf" fileUrl="/report.pdf" fitToContainer />
        </MessagesProvider>,
      );
      const fits = screen.getAllByRole("button", { pressed: false });
      expect(fits).toHaveLength(1);
      expect(fits[0].textContent).toBeTruthy();
    },
  );
});
