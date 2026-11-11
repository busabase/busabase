"use client";

import { Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import { type ReactNode, type RefObject, useCallback, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useViewerHeightClass } from "./viewer-layout";
import { useViewerShortcuts } from "./viewer-shortcuts";

const ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200, 300, 400];
const MIN_ZOOM = 10;
const MAX_ZOOM = 500;

type FitMode = "width" | "height" | "none";

export interface ZoomableCanvasProps {
  /** The canvas the viewer draws the image into. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  fileName: string;
  /** The image's own size, in pixels. */
  width: number;
  height: number;
  watermark?: string | null;
  /** Keep the image from being selected (a share link that forbids downloading). */
  guardContent: boolean;
  /** After the file's name and size, e.g. TIFF's "Page 1 of 3". */
  info?: ReactNode;
  /** After the zoom controls, e.g. TIFF's page navigation. */
  controls?: ReactNode;
  /** Keys beyond zoom, e.g. TIFF's page keys; zoom keys never reach it. */
  onKey?: (event: KeyboardEvent) => void;
  /** The shortcuts hint under the image. */
  hint: string;
}

/**
 * The frame the TIFF and PSD viewers draw into: the file's name and size, zoom
 * (buttons, levels, fit to width or height, Ctrl/⌘ + = - 0 and Ctrl/⌘ + wheel),
 * the watermark and a shortcuts hint. The viewer decodes the file, draws it
 * into `canvasRef` and adds what only it has.
 */
export function ZoomableCanvas({
  canvasRef,
  fileName,
  width,
  height,
  watermark,
  guardContent,
  info,
  controls,
  onKey,
  hint,
}: ZoomableCanvasProps) {
  const { LL } = useI18n();
  const heightClass = useViewerHeightClass();
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100); // percent
  const [fitMode, setFitMode] = useState<FitMode>("width");

  const zoomIn = useCallback(() => {
    setFitMode("none");
    setZoom((prev) => ZOOM_LEVELS.find((level) => level > prev) ?? Math.min(MAX_ZOOM, prev + 25));
  }, []);

  const zoomOut = useCallback(() => {
    setFitMode("none");
    setZoom(
      (prev) => ZOOM_LEVELS.findLast((level) => level < prev) ?? Math.max(MIN_ZOOM, prev - 25),
    );
  }, []);

  const shortcutRoot = useViewerShortcuts({
    keydown: (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        zoomIn();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        zoomOut();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        setZoom(100);
        setFitMode("none");
        return;
      }
      onKey?.(e);
    },
    wheel: (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) zoomIn();
        else zoomOut();
      }
    },
  });

  // Picking the fit already in use goes back to 100%.
  const fit = (mode: Exclude<FitMode, "none">) => {
    if (fitMode === mode) {
      setFitMode("none");
      setZoom(100);
    } else {
      setFitMode(mode);
    }
  };

  const displaySize = (() => {
    if (!width || !height) return { width, height };
    if (fitMode === "width" && containerRef.current) {
      const containerWidth = containerRef.current.clientWidth - 32; // padding
      return { width: containerWidth, height: height * (containerWidth / width) };
    }
    if (fitMode === "height" && containerRef.current) {
      const containerHeight = containerRef.current.clientHeight - 32; // padding
      return { width: width * (containerHeight / height), height: containerHeight };
    }
    return { width: width * (zoom / 100), height: height * (zoom / 100) };
  })();

  return (
    <div
      ref={shortcutRoot}
      tabIndex={-1}
      className={`relative w-full ${heightClass} bg-gray-100 flex flex-col outline-none`}
    >
      {watermark && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-6xl font-bold text-gray-300 opacity-20 rotate-[-45deg]">
            {watermark}
          </div>
        </div>
      )}

      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between gap-4">
        <div className="text-sm flex-shrink-0">
          <span className="font-semibold">{fileName}</span>
          <span className="ml-4 text-gray-400">
            {width} × {height}px
          </span>
          {info}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={zoomOut}
            disabled={zoom <= MIN_ZOOM}
            className="p-2 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title={LL.preview.zoomOutShortcut()}
          >
            <ZoomOut size={18} />
          </button>

          <select
            value={fitMode !== "none" ? fitMode : zoom}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "width" || value === "height") {
                fit(value);
              } else {
                setFitMode("none");
                setZoom(Number(value));
              }
            }}
            className="text-sm px-2 py-1 border rounded hover:bg-gray-50 min-w-[100px]"
          >
            <option value="width">{LL.preview.fitWidth()}</option>
            <option value="height">{LL.preview.fitHeight()}</option>
            <option disabled>───</option>
            {ZOOM_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}%
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={zoomIn}
            disabled={zoom >= MAX_ZOOM}
            className="p-2 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title={LL.preview.zoomInShortcut()}
          >
            <ZoomIn size={18} />
          </button>

          <button
            type="button"
            onClick={() => fit("width")}
            className={`p-2 rounded hover:bg-gray-100 ${fitMode === "width" ? "bg-blue-50 text-blue-600" : ""}`}
            title={LL.preview.fitToWidth()}
          >
            <Maximize2 size={18} />
          </button>

          <button
            type="button"
            onClick={() => fit("height")}
            className={`p-2 rounded hover:bg-gray-100 ${fitMode === "height" ? "bg-blue-50 text-blue-600" : ""}`}
            title={LL.preview.fitToHeight()}
          >
            <Minimize2 size={18} />
          </button>
        </div>

        {controls}
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto p-4 flex items-center justify-center">
        <canvas
          ref={canvasRef}
          className={`shadow-lg ${guardContent ? "select-none" : ""}`}
          style={{
            width: `${displaySize.width}px`,
            height: `${displaySize.height}px`,
            imageRendering: zoom > 100 ? "pixelated" : "auto",
          }}
        />
      </div>

      <div className="bg-gray-50 border-t border-gray-200 px-4 py-2 text-xs text-gray-500">
        {hint}
      </div>
    </div>
  );
}
