/// <reference path="../../types/ambient.d.ts" />
"use client";

import { Button } from "kui/button";
import { ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { useI18n } from "../i18n";
import type { Messages } from "../i18n/messages";
import { useDownloadGuard } from "./download-guard";
import { LoadingState } from "./LoadingState";
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

export default function PdfViewer({ fileUrl, fileName, watermark, noDownload }: PdfViewerProps) {
  const { LL } = useI18n();
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [loadError, setLoadError] = useState<Error | null>(null);

  // A share link that forbids downloading: no menu, save, print or text layer.
  const guardContent = useDownloadGuard(noDownload);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

  const goToPrevPage = () => {
    setPageNumber((prev) => Math.max(1, prev - 1));
  };

  const goToNextPage = () => {
    setPageNumber((prev) => Math.min(numPages, prev + 1));
  };

  const zoomIn = () => {
    setScale((prev) => Math.min(2.5, prev + 0.25));
  };

  const zoomOut = () => {
    setScale((prev) => Math.max(0.5, prev - 0.25));
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = fileName;
    link.click();
  };

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Watermark */}
      {watermark && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-6xl font-bold text-black/10 rotate-[-45deg] select-none whitespace-nowrap">
            {watermark}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-center gap-2 p-3 bg-muted border-b">
        <Button
          variant="outline"
          size="icon"
          onClick={goToPrevPage}
          disabled={pageNumber <= 1}
          aria-label={LL.preview.previousPage()}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-2 text-sm">
          <input
            type="number"
            min={1}
            max={numPages}
            value={pageNumber}
            onChange={(e) => {
              const page = Number.parseInt(e.target.value, 10);
              if (page >= 1 && page <= numPages) {
                setPageNumber(page);
              }
            }}
            className="w-16 px-2 py-1 text-center border rounded"
          />
          <span className="text-muted-foreground">/ {numPages || "-"}</span>
        </div>

        <Button
          variant="outline"
          size="icon"
          onClick={goToNextPage}
          disabled={pageNumber >= numPages}
          aria-label={LL.preview.nextPage()}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="w-px h-6 bg-border mx-2" />

        <Button variant="outline" size="icon" onClick={zoomOut} disabled={scale <= 0.5}>
          <ZoomOut className="h-4 w-4" />
        </Button>

        <span className="text-sm font-medium min-w-[60px] text-center">
          {Math.round(scale * 100)}%
        </span>

        <Button variant="outline" size="icon" onClick={zoomIn} disabled={scale >= 2.5}>
          <ZoomIn className="h-4 w-4" />
        </Button>

        {!noDownload && (
          <>
            <div className="w-px h-6 bg-border mx-2" />
            <Button variant="outline" size="sm" onClick={handleDownload} className="gap-2">
              <Download className="h-4 w-4" />
              {LL.preview.download()}
            </Button>
          </>
        )}
      </div>

      {/* PDF Document */}
      <div className="flex-1 overflow-auto bg-muted p-4">
        <div className={`flex justify-center min-w-fit${guardContent ? " select-none" : ""}`}>
          <Document
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
            <Page
              pageNumber={pageNumber}
              scale={scale}
              renderTextLayer={!guardContent}
              renderAnnotationLayer={!guardContent}
              className="shadow-lg"
            />
          </Document>
        </div>
      </div>
    </div>
  );
}
