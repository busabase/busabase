"use client";

import { readPsd } from "ag-psd";
import { useFileFetch } from "previewfile-core/client/file-fetch";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useDownloadGuard } from "./download-guard";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { ViewerError } from "./viewer-error";
import { ZoomableCanvas } from "./zoomable-canvas";

interface PsdViewerProps {
  fileUrl: string;
  fileName: string;
  watermark?: string | null;
  noDownload?: boolean;
}

/**
 * PSD (Photoshop Document) Viewer
 * Uses ag-psd library to parse and render PSD files
 * Zoom, watermark and the shortcuts hint come from ZoomableCanvas
 */
export default function PsdViewer({
  fileUrl,
  fileName,
  watermark,
  noDownload = false,
}: PsdViewerProps) {
  const guardContent = useDownloadGuard(noDownload);
  const { LL } = useI18n();
  // Use centralized file fetch hook
  const {
    data: arrayBuffer,
    loading: fetchLoading,
    error: fetchError,
  } = useFileFetch(fileUrl, "arrayBuffer");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const [psdImage, setPsdImage] = useState<HTMLCanvasElement | null>(null);

  // Parse PSD from ArrayBuffer
  const parsePsd = useCallback((arrayBuffer: ArrayBuffer) => {
    try {
      setLoading(true);
      setError(null);

      // Get binary data
      const data = new Uint8Array(arrayBuffer);

      // Parse PSD file using ag-psd
      const psd = readPsd(data, {
        skipLayerImageData: false,
        skipCompositeImageData: false,
      });

      if (!psd || !psd.canvas) {
        throw new ViewerError("psdParseFailed");
      }

      // Set dimensions
      setDimensions({ width: psd.width, height: psd.height });

      // Store the source canvas
      if (psd.canvas instanceof HTMLCanvasElement) {
        setPsdImage(psd.canvas);
      } else {
        throw new ViewerError("psdNoComposite");
      }

      setLoading(false);
    } catch (err) {
      console.error("Error loading PSD file:", err);
      setError(err instanceof Error ? err : new Error("Unknown error"));
      setLoading(false);
    }
  }, []);

  // Parse PSD when arrayBuffer is available
  useEffect(() => {
    // Handle fetch errors
    if (fetchError) {
      setError(fetchError);
      setLoading(false);
      return;
    }

    // Wait for arrayBuffer to be fetched
    if (fetchLoading || !arrayBuffer) {
      setLoading(true);
      return;
    }

    parsePsd(arrayBuffer);
  }, [arrayBuffer, fetchLoading, fetchError, parsePsd]);

  // Draw to canvas when image data is available and canvas is mounted
  useEffect(() => {
    if (!loading && psdImage && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx || !dimensions.width || !dimensions.height) return;

      // Set canvas size
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;

      // Draw the composite image
      ctx.drawImage(psdImage, 0, 0);
    }
  }, [loading, psdImage, dimensions]);

  if (loading) {
    return <LoadingState message={LL.preview.loadingPsdImage()} />;
  }

  if (error) {
    return <ErrorState error={error} onRetry={() => window.location.reload()} />;
  }

  return (
    <ZoomableCanvas
      canvasRef={canvasRef}
      fileName={fileName}
      width={dimensions.width}
      height={dimensions.height}
      watermark={watermark}
      guardContent={guardContent}
      hint={LL.preview.zoomTip()}
    />
  );
}
