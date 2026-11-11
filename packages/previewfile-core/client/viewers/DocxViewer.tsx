import { AlertCircle, FileText } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { DOCX_PAGE_CLASS, deferOffscreenPages, dropBreakOnlyPages } from "./docx-pages";
import { useDownloadGuard } from "./download-guard";
import { I18nOfficeViewerLoading } from "./I18nLoadingState";
import { LoadingState } from "./LoadingState";

const DOCX_VIEWER_GLOBAL_CSS = `
.docx-viewer-container .docx-wrapper {
  background: transparent !important;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.docx-viewer-container .docx-wrapper > section.docx {
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06) !important;
  margin-bottom: 24px;
  background: white;
  border-radius: 4px;
}
.docx-viewer-container .docx {
  padding: 40px;
}
`;

// Dynamically import OfficeViewer for legacy .doc files
const OfficeViewer = dynamic(() => import("./OfficeViewer"), {
  ssr: false,
  loading: I18nOfficeViewerLoading,
});

interface DocxViewerProps {
  fileUrl: string;
  fileName?: string;
  watermark?: string | null;
  noDownload?: boolean;
  /** Short URL identifier for proxy-based PDF serving */
  shortUrl?: string;
  /** Already-verified password for `shortUrl`, for the OfficeViewer fallback. */
  accessPassword?: string;
}

// `className: "docx-preview-wrapper"` below makes docx-preview name its wrapper
// `docx-preview-wrapper-wrapper`; scoping to our container outranks its rule.
const DOCX_WRAPPER_ALIGNMENT_CSS =
  ".docx-viewer-container .docx-preview-wrapper-wrapper { align-items: safe center; }";

export default function DocxViewer({
  fileUrl,
  fileName,
  watermark,
  noDownload,
  shortUrl,
  accessPassword,
}: DocxViewerProps) {
  const { LL } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  // A share link that may not be downloaded may not be copied, saved or printed
  // from here either — the same guard its PDF had when .docx went through the
  // converter. Embedded (`fill`), `noDownload` only means the host shows its own
  // download button, so the text stays selectable there.
  const guardContent = useDownloadGuard(noDownload);

  // Check if file is a legacy .doc format
  const isLegacyDoc =
    fileName?.toLowerCase().endsWith(".doc") && !fileName?.toLowerCase().endsWith(".docx");

  useEffect(() => {
    // For legacy .doc files, use OfficeViewer (LibreOffice conversion) directly
    if (isLegacyDoc) {
      setUseFallback(true);
      setLoading(false);
      return;
    }

    const loadDocx = async () => {
      if (!containerRef.current) return;

      try {
        setLoading(true);
        setError(null);

        // Dynamically import docx-preview (client-side only)
        const { renderAsync } = await import("docx-preview");

        // Fetch the docx file
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch document: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();
        // Unmounted or switched file while fetching: nothing left to draw into.
        const container = containerRef.current;
        if (cancelled || !container) return;

        // Clear container before rendering
        container.innerHTML = "";

        // Render the docx file
        await renderAsync(blob, container, undefined, {
          className: DOCX_PAGE_CLASS,
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          // Page where Word did (see `dropBreakOnlyPages`): a document with no
          // hard page break is otherwise one page, which cannot be deferred.
          ignoreLastRenderedPageBreak: false,
          experimental: false,
          trimXmlDeclaration: true,
          useBase64URL: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        });

        // Before the browser lays the pages out: that is where the time goes.
        dropBreakOnlyPages(container);
        deferOffscreenPages(container);

        if (!cancelled) setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error("DocxViewer error:", err);
        // If docx-preview fails, try fallback
        setUseFallback(true);
        setLoading(false);
      }
    };

    let cancelled = false;
    loadDocx();
    return () => {
      cancelled = true;
    };
  }, [fileUrl, isLegacyDoc]);

  // Fallback viewer - use OfficeViewer for LibreOffice PDF conversion
  if (useFallback) {
    return (
      <OfficeViewer
        fileUrl={fileUrl}
        fileName={fileName || "document.doc"}
        watermark={watermark}
        noDownload={noDownload}
        shortUrl={shortUrl}
        accessPassword={accessPassword}
      />
    );
  }

  // Error State (Polished)
  if (error && !useFallback) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-6 p-8 bg-muted/10 rounded-lg border border-border/50">
        <div className="relative">
          <FileText className="w-20 h-20 text-muted-foreground/30" />
          <AlertCircle className="w-8 h-8 text-destructive absolute -bottom-2 -right-2 bg-background rounded-full" />
        </div>
        <div className="text-center max-w-md space-y-2">
          <h3 className="text-lg font-semibold text-foreground">
            {LL.preview.failedToLoadDocumentTitle()}
          </h3>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
        {fileName && (
          <div className="bg-muted/40 rounded-lg px-4 py-2 text-sm border border-border/50">
            <span className="font-medium text-foreground">{fileName}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {/* Unified Loading State */}
      {loading && (
        <div className="absolute inset-0 z-20">
          <LoadingState
            message={LL.preview.loadingDocument()}
            fileName={fileName}
            secondaryMessage={LL.preview.mayTakeFewSeconds()}
          />
        </div>
      )}

      {/* docx-preview centres its fixed-width pages (`align-items: center`). In a
          frame narrower than a page that pushes the page's left edge out of the
          scrollable area, where no scrollbar can reach it. `safe center` keeps
          the centring while the page fits and starts it at the left edge when
          it does not; browsers without `safe` keep today's behaviour. */}
      <style>{DOCX_WRAPPER_ALIGNMENT_CSS}</style>
      <div
        ref={containerRef}
        className={`docx-viewer-container w-full h-full overflow-auto ${guardContent ? "select-none" : ""}`}
        onCopy={guardContent ? (event) => event.preventDefault() : undefined}
      />

      {watermark && !loading && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-45 text-6xl font-bold text-black/10 pointer-events-none select-none z-20">
          {watermark}
        </div>
      )}

      <style
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static CSS string defined above
        dangerouslySetInnerHTML={{ __html: DOCX_VIEWER_GLOBAL_CSS }}
      />
    </div>
  );
}
