/// <reference path="../../types/ambient.d.ts" />
"use client";

import { Button } from "kui/button";
import { ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut } from "lucide-react";
import { SegmentedControl, SegmentedControlItem } from "openlib/ui/segmented-control";
import { type ComponentProps, useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { useI18n } from "../i18n";
import type { Messages } from "../i18n/messages";
import { useDownloadGuard } from "./download-guard";
import { LoadingState } from "./LoadingState";
import { PdfContinuousPages, type PdfNavigation } from "./PdfContinuousPages";
import type { PdfDocument } from "./use-pdf-page-geometries";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// 配置 PDF.js worker（仅在客户端）
if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

interface PdfViewerProps {
  fileUrl: string;
  fileName: string;
  watermark?: string | null;
  noDownload?: boolean;
  fitToContainer?: boolean;
  pdfScrollMode?: "single" | "continuous";
}

type FitMode = "width" | "page" | "manual";

interface PageGeometry {
  pageNumber: number;
  width: number;
  height: number;
  scale?: number;
}

/** Why pdf.js could not open the file, which it says by the error's name. */
function pdfLoadReason(messages: Messages, error: Error | null): string {
  // An empty file, or one that is not a PDF.
  if (error?.name === "InvalidPDFException") return messages.errorCorrupted();
  // The server answered with something other than the file.
  if (error?.name === "ResponseException") {
    const { status } = error as Error & { status?: number };
    if (status === 404) return messages.errorNotFound();
    if (status === 403) return messages.errorForbidden();
    if (status && status >= 500) return messages.errorServer();
    return messages.errorNetwork();
  }
  return messages.pdfLoadErrorDesc();
}

function PdfViewerContent({
  fileUrl,
  fileName,
  watermark,
  noDownload,
  fitToContainer = false,
  pdfScrollMode = "single",
}: PdfViewerProps) {
  const { LL } = useI18n();
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [manualScale, setManualScale] = useState<number>(1.0);
  const [fitMode, setFitMode] = useState<FitMode>(fitToContainer ? "page" : "width");
  const [pageGeometry, setPageGeometry] = useState<PageGeometry | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PdfDocument | null>(null);
  const [navigation, setNavigation] = useState<PdfNavigation>({ page: 1, request: 0 });
  const continuous = pdfScrollMode === "continuous";
  const toolbarButtonVariant = fitToContainer ? "ghost" : "outline";
  const toolbarButtonClassName = fitToContainer
    ? "size-8 text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground"
    : undefined;
  // Reserve padding and native spinner space; total digits keep navigation from resizing the field.
  const pageInputWidth = `calc(${String(Math.max(1, numPages)).length}ch + var(--spacing) * 10)`;

  useEffect(() => {
    const element = viewportRef.current;
    if ((!fitToContainer && !continuous) || !element) return;

    const measure = () => {
      const style = getComputedStyle(element);
      const padding = (value: string) => Number.parseFloat(value) || 0;
      const width = Math.max(
        0,
        element.clientWidth - padding(style.paddingLeft) - padding(style.paddingRight),
      );
      const height = Math.max(
        0,
        element.clientHeight - padding(style.paddingTop) - padding(style.paddingBottom),
      );
      setViewport((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitToContainer, continuous]);

  const onPageLoadSuccess = useCallback<NonNullable<ComponentProps<typeof Page>["onLoadSuccess"]>>(
    (page) => {
      const { width, height } = page.getViewport({ scale: 1 });
      setPageGeometry((previous) =>
        previous?.pageNumber === page.pageNumber &&
        previous.width === width &&
        previous.height === height
          ? previous
          : { pageNumber: page.pageNumber, width, height },
      );
    },
    [],
  );

  // Until the new page reports its size, fit with the previous page's so a page
  // turn never paints at the manual scale; the first page stays hidden instead.
  const fitting = fitToContainer && fitMode !== "manual";
  const canFit =
    pageGeometry !== null &&
    pageGeometry.width > 0 &&
    pageGeometry.height > 0 &&
    viewport.width > 0 &&
    viewport.height > 0;
  let scale = manualScale;
  if (fitting && canFit) {
    scale = viewport.width / pageGeometry.width;
    if (fitMode === "page") {
      scale = Math.min(scale, viewport.height / pageGeometry.height);
    }
  }
  if (continuous && fitting && pageGeometry?.scale !== undefined) scale = pageGeometry.scale;

  // A share link that forbids downloading: no menu, save, print or text layer.
  const guardContent = useDownloadGuard(noDownload);

  function onDocumentLoadSuccess(document: PdfDocument) {
    setNumPages(document.numPages);
    setPdfDocument(document);
  }

  const navigateToPage = (page: number) => {
    setPageNumber(page);
    if (continuous) {
      setNavigation((previous) => ({ page, request: previous.request + 1 }));
    }
  };

  const onContinuousGeometryChange = useCallback((geometry: PageGeometry) => {
    setPageGeometry((previous) =>
      previous?.pageNumber === geometry.pageNumber &&
      previous.width === geometry.width &&
      previous.height === geometry.height &&
      previous.scale === geometry.scale
        ? previous
        : geometry,
    );
  }, []);

  const goToPrevPage = () => {
    navigateToPage(Math.max(1, pageNumber - 1));
  };

  const goToNextPage = () => {
    navigateToPage(Math.min(numPages, pageNumber + 1));
  };

  const zoomIn = () => {
    setManualScale(Math.min(2.5, Math.max(0.5, scale + 0.25)));
    setFitMode("manual");
  };

  const zoomOut = () => {
    setManualScale(Math.max(0.5, Math.min(2.5, scale - 0.25)));
    setFitMode("manual");
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = fileName;
    link.click();
  };

  return (
    <div className={`relative w-full h-full flex flex-col${fitToContainer ? " min-h-0" : ""}`}>
      {/* Watermark */}
      {watermark && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-6xl font-bold text-black/10 rotate-[-45deg] select-none whitespace-nowrap">
            {watermark}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div
        className={
          fitToContainer
            ? "flex shrink-0 flex-wrap items-center justify-center gap-2 border-b bg-background px-3 py-2"
            : "flex items-center justify-center gap-2 p-3 bg-muted border-b"
        }
      >
        <Button
          variant={toolbarButtonVariant}
          size="icon"
          className={toolbarButtonClassName}
          onClick={goToPrevPage}
          disabled={pageNumber <= 1}
          aria-label={LL.preview.previousPage()}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className={`flex items-center gap-2 ${fitToContainer ? "text-xs" : "text-sm"}`}>
          <input
            type="number"
            min={1}
            max={numPages}
            value={pageNumber}
            style={{ width: pageInputWidth }}
            aria-label={LL.preview.pageOf({ page: pageNumber, total: numPages })}
            onChange={(e) => {
              const page = Number.parseInt(e.target.value, 10);
              if (page >= 1 && page <= numPages) {
                navigateToPage(page);
              }
            }}
            className={
              fitToContainer
                ? "h-8 min-w-12 shrink-0 rounded-md border border-input bg-background px-2 text-center text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                : "min-w-16 shrink-0 px-2 py-1 text-center tabular-nums border rounded"
            }
          />
          <span className="text-muted-foreground">/ {numPages || "-"}</span>
        </div>

        <Button
          variant={toolbarButtonVariant}
          size="icon"
          className={toolbarButtonClassName}
          onClick={goToNextPage}
          disabled={pageNumber >= numPages}
          aria-label={LL.preview.nextPage()}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="w-px h-6 bg-border mx-2" />

        {fitToContainer && (
          <SegmentedControl
            role="group"
            aria-label={`${LL.preview.fitWidth()} / ${LL.preview.fitPage()}`}
          >
            <SegmentedControlItem
              selected={fitMode === "width"}
              onClick={() => setFitMode("width")}
            >
              {LL.preview.fitWidth()}
            </SegmentedControlItem>
            <SegmentedControlItem selected={fitMode === "page"} onClick={() => setFitMode("page")}>
              {LL.preview.fitPage()}
            </SegmentedControlItem>
          </SegmentedControl>
        )}

        <Button
          variant={toolbarButtonVariant}
          size="icon"
          className={toolbarButtonClassName}
          onClick={zoomOut}
          disabled={scale <= 0.5}
          aria-label={LL.preview.zoomOut()}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>

        <span
          className={`font-medium min-w-[60px] text-center ${fitToContainer ? "text-xs" : "text-sm"}`}
        >
          {Math.round(scale * 100)}%
        </span>

        <Button
          variant={toolbarButtonVariant}
          size="icon"
          className={toolbarButtonClassName}
          onClick={zoomIn}
          disabled={scale >= 2.5}
          aria-label={LL.preview.zoomIn()}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>

        {!noDownload && (
          <>
            <div className="w-px h-6 bg-border mx-2" />
            <Button
              variant={toolbarButtonVariant}
              size={fitToContainer ? "icon" : "sm"}
              onClick={handleDownload}
              className={fitToContainer ? toolbarButtonClassName : "gap-2"}
              aria-label={LL.preview.download()}
            >
              <Download className="h-4 w-4" />
              {!fitToContainer && LL.preview.download()}
            </Button>
          </>
        )}
      </div>

      {/* PDF Document */}
      <div
        ref={viewportRef}
        className={`flex-1 ${continuous ? "overflow-hidden" : "overflow-auto"} bg-muted p-4${fitToContainer || continuous ? " min-h-0" : ""}`}
      >
        <div
          className={
            continuous
              ? "h-full min-h-0"
              : `flex justify-center min-w-fit${guardContent ? " select-none" : ""}`
          }
        >
          <Document
            className={continuous ? "h-full min-h-0" : undefined}
            file={fileUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={setLoadError}
            loading={<LoadingState message={LL.preview.loadingPdf()} />}
            error={
              <div className="p-8 text-center text-destructive">
                <p className="font-semibold">{LL.preview.pdfLoadErrorTitle()}</p>
                <p className="text-sm mt-2">{pdfLoadReason(LL.preview, loadError)}</p>
              </div>
            }
          >
            {continuous ? (
              pdfDocument && (
                <PdfContinuousPages
                  key={fileUrl}
                  fileName={fileName}
                  document={pdfDocument}
                  viewport={viewport}
                  fitMode={fitToContainer ? fitMode : "manual"}
                  manualScale={manualScale}
                  navigation={navigation}
                  guardContent={guardContent}
                  onPageChange={setPageNumber}
                  onGeometryChange={onContinuousGeometryChange}
                />
              )
            ) : (
              <Page
                pageNumber={pageNumber}
                scale={scale}
                onLoadSuccess={fitToContainer ? onPageLoadSuccess : undefined}
                renderTextLayer={!guardContent}
                renderAnnotationLayer={!guardContent}
                className={`shadow-lg${fitting && !canFit ? " invisible" : ""}`}
              />
            )}
          </Document>
        </div>
      </div>
    </div>
  );
}

/** A different file starts a fresh document, navigation and scale lifecycle. */
export default function PdfViewer(props: PdfViewerProps) {
  return <PdfViewerContent key={props.fileUrl} {...props} />;
}
