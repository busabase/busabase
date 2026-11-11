"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import UTIF from "utif";
import { useI18n } from "../i18n";
import { useDownloadGuard } from "./download-guard";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { ViewerError } from "./viewer-error";
import { ZoomableCanvas } from "./zoomable-canvas";

interface TiffViewerProps {
  fileUrl: string;
  fileName: string;
  watermark?: string | null;
  noDownload?: boolean;
}

/**
 * TIFF 图片查看器
 * 使用 UTIF.js 解析和渲染 TIFF 图片
 * 支持单页和多页 TIFF；缩放、水印和快捷键提示由 ZoomableCanvas 提供，这里只加翻页
 */
export default function TiffViewer({
  fileUrl,
  fileName,
  watermark,
  noDownload = false,
}: TiffViewerProps) {
  const guardContent = useDownloadGuard(noDownload);
  const { LL } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pages, setPages] = useState<unknown[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const fetchTiff = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(fileUrl);
      if (!response.ok) throw new ViewerError("tiffLoadFailed");

      // 获取二进制数据
      const arrayBuffer = await response.arrayBuffer();

      // 使用 UTIF 解析 TIFF
      const ifds = UTIF.decode(arrayBuffer);
      if (!ifds || ifds.length === 0) {
        throw new ViewerError("tiffNoPages");
      }

      // 解码所有页面
      for (const ifd of ifds) {
        UTIF.decodeImage(arrayBuffer, ifd);
      }

      setPages(ifds);
      setCurrentPage(0);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
      setLoading(false);
    }
  }, [fileUrl]);

  useEffect(() => {
    fetchTiff();
  }, [fetchTiff]);

  // 渲染当前页到 canvas
  useEffect(() => {
    if (pages.length === 0 || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      const page: any = pages[currentPage];
      if (!page) return;

      // 设置 canvas 尺寸
      canvas.width = page.width;
      canvas.height = page.height;
      setDimensions({ width: page.width, height: page.height });

      // 将 RGBA 数据转换为 ImageData
      const rgba = UTIF.toRGBA8(page);
      const imageData = new ImageData(new Uint8ClampedArray(rgba), page.width, page.height);

      // 绘制到 canvas
      ctx.putImageData(imageData, 0, 0);
    } catch (err) {
      console.error("Error rendering TIFF page:", err);
      setError(new ViewerError("tiffRenderFailed"));
    }
  }, [pages, currentPage]);

  // Page keys (multi-page TIFF); ZoomableCanvas handles the zoom keys.
  const handlePageKey = (e: KeyboardEvent) => {
    if (pages.length <= 1) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      setCurrentPage((prev) => Math.max(0, prev - 1));
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      setCurrentPage((prev) => Math.min(pages.length - 1, prev + 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setCurrentPage(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setCurrentPage(pages.length - 1);
    }
  };

  if (loading) {
    return <LoadingState message={LL.preview.loadingTiffImage()} />;
  }

  if (error) {
    return <ErrorState error={error} onRetry={fetchTiff} />;
  }

  const hasMultiplePages = pages.length > 1;

  return (
    <ZoomableCanvas
      canvasRef={canvasRef}
      fileName={fileName}
      width={dimensions.width}
      height={dimensions.height}
      watermark={watermark}
      guardContent={guardContent}
      onKey={handlePageKey}
      hint={hasMultiplePages ? LL.preview.zoomAndPagesTip() : LL.preview.zoomTip()}
      info={
        hasMultiplePages && (
          <span className="ml-4 text-gray-400">
            {LL.preview.pageOf({ page: currentPage + 1, total: pages.length })}
          </span>
        )
      }
      controls={
        hasMultiplePages && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              className="p-2 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              title={LL.preview.previousPageShortcut()}
            >
              <ChevronLeft size={20} />
            </button>
            <span className="text-sm text-gray-600 min-w-[60px] text-center">
              {currentPage + 1} / {pages.length}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage(Math.min(pages.length - 1, currentPage + 1))}
              disabled={currentPage === pages.length - 1}
              className="p-2 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              title={LL.preview.nextPageShortcut()}
            >
              <ChevronRight size={20} />
            </button>
          </div>
        )
      }
    />
  );
}
