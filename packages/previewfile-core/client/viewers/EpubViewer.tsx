"use client";

import ePub from "epubjs";
import { Button } from "kui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { ChevronLeft, ChevronRight, Download, List, ZoomIn, ZoomOut } from "lucide-react";
import { useFileFetch } from "previewfile-core/client/file-fetch";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { ViewerError } from "./viewer-error";
import { useViewerLayout } from "./viewer-layout";

interface EpubViewerProps {
  fileUrl: string;
  fileName: string;
  watermark?: string | null;
  noDownload?: boolean;
}

export default function EpubViewer({ fileUrl, fileName, watermark, noDownload }: EpubViewerProps) {
  const { LL } = useI18n();
  const fillsParent = useViewerLayout() === "fill";

  // Use centralized file fetch hook
  const {
    data: arrayBuffer,
    loading: fetchLoading,
    error: fetchError,
  } = useFileFetch(fileUrl, "arrayBuffer");

  const viewerRef = useRef<HTMLDivElement>(null);
  // Use refs to store book and rendition to avoid cleanup issues with React Strict Mode
  const bookRef = useRef<any>(null);
  const renditionRef = useRef<any>(null);
  const [rendition, setRendition] = useState<any | null>(null);
  const [toc, setToc] = useState<any[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [fontSize, setFontSize] = useState(100);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retryTrigger, setRetryTrigger] = useState(0);

  // Retry function for error state
  const handleRetry = useCallback(() => {
    setError(null);
    setRetryTrigger((prev) => prev + 1);
  }, []);

  // Cleanup function - only destroys book/rendition, doesn't clear DOM
  const cleanupRefs = useCallback(() => {
    console.log("[EpubViewer] Cleanup refs called");
    if (renditionRef.current) {
      try {
        renditionRef.current.destroy();
      } catch (cleanupErr) {
        console.warn("Error cleaning up rendition:", cleanupErr);
      }
      renditionRef.current = null;
    }
    if (bookRef.current) {
      try {
        bookRef.current.destroy();
      } catch (cleanupErr) {
        console.warn("Error cleaning up book:", cleanupErr);
      }
      bookRef.current = null;
    }
  }, []);

  // Initialize EPUB
  // biome-ignore lint/correctness/useExhaustiveDependencies: retryTrigger is intentionally used to re-trigger the effect on retry
  useEffect(() => {
    if (!viewerRef.current || !fileUrl) return;

    let mounted = true;

    const loadBook = async () => {
      try {
        // Clean up any existing book/rendition first (but don't clear DOM yet)
        cleanupRefs();

        setIsLoading(true);
        setIsReady(false);
        setError(null);

        // Clear the viewer container before loading new content
        if (viewerRef.current) {
          viewerRef.current.innerHTML = "";
        }

        console.log("[EpubViewer] Starting to load EPUB from fetched arrayBuffer");

        // Handle fetch errors
        if (fetchError) {
          throw fetchError;
        }

        // Wait for arrayBuffer to be fetched
        if (fetchLoading || !arrayBuffer) {
          setIsLoading(true);
          return;
        }

        console.log("[EpubViewer] ArrayBuffer size:", arrayBuffer.byteLength);

        // Basic validation: EPUB files are ZIP archives and should start with PK signature
        const header = new Uint8Array(arrayBuffer.slice(0, 4));
        const isPKSignature = header[0] === 0x50 && header[1] === 0x4b; // "PK"

        if (!isPKSignature) {
          throw new ViewerError("epubInvalid");
        }

        if (!mounted) return;

        // Initialize with ArrayBuffer
        console.log("[EpubViewer] Initializing epub.js with ArrayBuffer");
        const newBook = ePub(arrayBuffer);
        bookRef.current = newBook;

        // Wait for book to be ready before rendering
        await newBook.ready;
        console.log("[EpubViewer] Book ready");

        if (!mounted) return;

        // Ensure container has dimensions before rendering
        if (!viewerRef.current) {
          throw new Error("Viewer container not available");
        }

        // Check if container has dimensions - wait longer if needed
        let rect = viewerRef.current.getBoundingClientRect();
        console.log("[EpubViewer] Initial container dimensions:", rect.width, "x", rect.height);

        let retries = 0;
        while ((rect.width === 0 || rect.height === 0) && retries < 10) {
          // Wait for container to get dimensions
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (!viewerRef.current) {
            throw new Error("Viewer container lost during dimension wait");
          }
          rect = viewerRef.current.getBoundingClientRect();
          retries++;
        }

        if (rect.width === 0 || rect.height === 0) {
          console.warn("Container has zero dimensions, using fallback size");
        }

        if (!mounted || !viewerRef.current) return;

        // Get container dimensions for rendering
        const containerRect = viewerRef.current.getBoundingClientRect();
        // Use actual dimensions or fallback to reasonable defaults
        const width = containerRect.width > 100 ? containerRect.width : window.innerWidth - 40;
        const height = containerRect.height > 100 ? containerRect.height : window.innerHeight - 150;

        console.log("[EpubViewer] Rendering with dimensions:", width, "x", height);

        const newRendition = bookRef.current.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          manager: "default",
          spread: "none", // Single page view for better compatibility
        });
        renditionRef.current = newRendition;
        setRendition(newRendition);

        // Apply default theme styles to ensure content is visible
        newRendition.themes.default({
          body: {
            "font-family": "system-ui, -apple-system, sans-serif",
            "line-height": "1.6",
            padding: "20px",
          },
          p: {
            margin: "1em 0",
          },
        });

        // Display the book - wait for it to complete
        console.log("[EpubViewer] Calling display()");
        const displayed = renditionRef.current.display();
        await displayed;
        console.log("[EpubViewer] Display complete");

        if (!mounted) return;

        // Trigger a resize after display to ensure content fills the container
        setTimeout(() => {
          if (mounted && viewerRef.current && renditionRef.current) {
            console.log("[EpubViewer] Post-display resize triggered");
            try {
              // Force a re-render by resizing
              renditionRef.current.resize("100%", "100%");
            } catch (err) {
              console.warn("Error resizing after display:", err);
            }
          }
        }, 300);

        // Load TOC
        console.log("[EpubViewer] Loading TOC");
        bookRef.current.loaded.navigation
          .then((nav: any) => {
            if (mounted) {
              setToc(nav.toc || []);
            }
          })
          .catch((err: Error) => {
            console.warn("Failed to load TOC:", err);
            // TOC failure is not critical, continue
          });

        setIsReady(true);
        setIsLoading(false);
        console.log("[EpubViewer] EPUB loaded successfully");
      } catch (err) {
        console.error("[EpubViewer] Failed to load EPUB:", err);
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setError(errorObj);
        setIsLoading(false);
        setIsReady(false);

        // Clean up on error
        cleanupRefs();
      }
    };

    loadBook();

    return () => {
      mounted = false;
      // Don't cleanup on unmount in development (Strict Mode double-mount)
      // The cleanup will happen on the next load or when component is truly unmounted
      console.log("[EpubViewer] Effect cleanup - mounted:", mounted);
    };
  }, [arrayBuffer, fetchLoading, fetchError, retryTrigger, cleanupRefs]); // retryTrigger is needed for retry functionality

  const prevPage = () => {
    try {
      rendition?.prev();
    } catch (err) {
      console.error("Error navigating to previous page:", err);
    }
  };

  const nextPage = () => {
    try {
      rendition?.next();
    } catch (err) {
      console.error("Error navigating to next page:", err);
    }
  };

  const handleZoomIn = () => {
    try {
      const newSize = fontSize + 10;
      setFontSize(newSize);
      rendition?.themes.fontSize(`${newSize}%`);
    } catch (err) {
      console.error("Error zooming in:", err);
    }
  };

  const handleZoomOut = () => {
    try {
      const newSize = Math.max(50, fontSize - 10);
      setFontSize(newSize);
      rendition?.themes.fontSize(`${newSize}%`);
    } catch (err) {
      console.error("Error zooming out:", err);
    }
  };

  const navigateToChapter = (href: string) => {
    try {
      rendition?.display(href);
    } catch (err) {
      console.error("Error navigating to chapter:", err);
    }
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = fileName;
    link.click();
  };

  // Handle window resize to update rendition dimensions
  useEffect(() => {
    if (!rendition || !viewerRef.current || !isReady) return;

    const handleResize = () => {
      if (!viewerRef.current || !rendition) return;
      try {
        rendition.resize("100%", "100%");
      } catch (err) {
        console.warn("Error resizing rendition:", err);
      }
    };

    // Debounce resize handler
    let resizeTimeout: NodeJS.Timeout;
    const debouncedResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(handleResize, 150);
    };

    window.addEventListener("resize", debouncedResize);

    // Initial resize after mount
    handleResize();

    return () => {
      window.removeEventListener("resize", debouncedResize);
      clearTimeout(resizeTimeout);
    };
  }, [rendition, isReady]);

  // Show error state
  if (error) {
    return (
      <ErrorState error={error} onRetry={handleRetry} title={LL.preview.epubLoadFailedTitle()} />
    );
  }

  return (
    <div
      className={
        fillsParent
          ? "relative w-full h-full flex flex-col bg-background"
          : "relative w-full h-full min-h-[70vh] flex flex-col bg-background"
      }
    >
      {/* Loading overlay - shown on top of the viewer container */}
      {(isLoading || !isReady) && (
        <div className="absolute inset-0 z-30 bg-background">
          <LoadingState message={LL.preview.loadingEbook()} />
        </div>
      )}

      {/* Watermark */}
      {watermark && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 overflow-hidden">
          <div className="text-6xl font-bold text-black/5 rotate-[-45deg] select-none whitespace-nowrap">
            {watermark}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 bg-muted border-b z-20">
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" title={LL.preview.tableOfContents()}>
                <List className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 max-h-[300px] overflow-y-auto">
              {toc.length > 0 ? (
                toc.map((item: any, index: number) => (
                  // biome-ignore lint: TOC items may not have unique IDs, using index is acceptable
                  <DropdownMenuItem key={index} onClick={() => navigateToChapter(item.href)}>
                    {item.label}
                  </DropdownMenuItem>
                ))
              ) : (
                <div className="p-2 text-sm text-muted-foreground">{LL.preview.noChapters()}</div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={prevPage} disabled={!rendition}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={nextPage} disabled={!rendition}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={handleZoomOut} disabled={!rendition}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-sm w-12 text-center select-none">{fontSize}%</span>
          <Button variant="ghost" size="icon" onClick={handleZoomIn} disabled={!rendition}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          {!noDownload && (
            <Button
              variant="outline"
              size="icon"
              onClick={handleDownload}
              title={LL.preview.download()}
            >
              <Download className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Viewer Area - always rendered so epubjs has a DOM element to render into */}
      <div
        className="flex-1 overflow-hidden relative bg-white"
        style={fillsParent ? undefined : { minHeight: "calc(100vh - 100px)" }}
      >
        <div
          ref={viewerRef}
          className="absolute inset-0"
          style={{
            width: "100%",
            height: "100%",
          }}
        />

        {/* Helper text for navigation */}
        {isReady && (
          <div className="absolute bottom-2 right-4 text-xs text-muted-foreground pointer-events-none opacity-50 z-10">
            {LL.preview.epubNavHint()}
          </div>
        )}
      </div>
    </div>
  );
}
