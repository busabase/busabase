"use client";

import { AlertCircle } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConverter } from "../converter";
import { useI18n } from "../i18n";
import { explainError } from "./explain-error";
import { LoadingState } from "./LoadingState";

/**
 * MIME type mapping for Office document formats
 * Used to send correct MIME type to the conversion API
 * Comprehensive list of formats that LibreOffice can convert
 */
const OFFICE_MIME_TYPES: Record<string, string> = {
  // ===== Word Processing Formats =====
  // Microsoft Word
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  docm: "application/vnd.ms-word.document.macroEnabled.12",
  dot: "application/msword",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  dotm: "application/vnd.ms-word.template.macroEnabled.12",
  // OpenDocument Text
  odt: "application/vnd.oasis.opendocument.text",
  ott: "application/vnd.oasis.opendocument.text-template",
  fodt: "application/vnd.oasis.opendocument.text",
  // Rich Text Format
  rtf: "application/rtf",
  // WordPerfect
  wpd: "application/vnd.wordperfect",
  wps: "application/vnd.ms-works",
  // Apple Pages
  pages: "application/vnd.apple.pages",
  // Lotus Word Pro
  lwp: "application/vnd.lotus-wordpro",

  // ===== Spreadsheet Formats =====
  // Microsoft Excel
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xlsb: "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
  xlt: "application/vnd.ms-excel",
  xltx: "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  xltm: "application/vnd.ms-excel.template.macroEnabled.12",
  // OpenDocument Spreadsheet
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  ots: "application/vnd.oasis.opendocument.spreadsheet-template",
  fods: "application/vnd.oasis.opendocument.spreadsheet",
  // Lotus 1-2-3
  "123": "application/vnd.lotus-1-2-3",
  wk1: "application/vnd.lotus-1-2-3",
  wk2: "application/vnd.lotus-1-2-3",
  wk3: "application/vnd.lotus-1-2-3",
  wk4: "application/vnd.lotus-1-2-3",
  wks: "application/vnd.lotus-1-2-3",
  // Apple Numbers
  numbers: "application/vnd.apple.numbers",
  // Quattro Pro
  wb2: "application/x-quattropro",
  wq1: "application/x-quattropro",
  wq2: "application/x-quattropro",

  // ===== Presentation Formats =====
  // Microsoft PowerPoint
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pptm: "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
  pot: "application/vnd.ms-powerpoint",
  potx: "application/vnd.openxmlformats-officedocument.presentationml.template",
  potm: "application/vnd.ms-powerpoint.template.macroEnabled.12",
  pps: "application/vnd.ms-powerpoint",
  ppsx: "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
  ppsm: "application/vnd.ms-powerpoint.slideshow.macroEnabled.12",
  // OpenDocument Presentation
  odp: "application/vnd.oasis.opendocument.presentation",
  otp: "application/vnd.oasis.opendocument.presentation-template",
  fodp: "application/vnd.oasis.opendocument.presentation",
  // Apple Keynote
  key: "application/vnd.apple.keynote",
  kth: "application/vnd.apple.keynote",

  // ===== Graphics/Drawing Formats =====
  // OpenDocument Graphics
  odg: "application/vnd.oasis.opendocument.graphics",
  otg: "application/vnd.oasis.opendocument.graphics-template",
  // Microsoft Visio
  vsd: "application/vnd.visio",
  vsdx: "application/vnd.ms-visio.drawing",
  // CorelDRAW
  cdr: "application/vnd.corel-draw",
  // Windows Metafile
  wmf: "application/x-msmetafile",
  emf: "application/x-emf",
};

/**
 * Get MIME type from file name extension
 */
function getMimeTypeFromFileName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext && OFFICE_MIME_TYPES[ext]) {
    return OFFICE_MIME_TYPES[ext];
  }
  // Default fallback for unknown Office formats
  return "application/octet-stream";
}

function PdfViewerLoading() {
  const { LL } = useI18n();

  return <LoadingState message={LL.preview.loadingPdfViewer()} />;
}

const PdfViewer = dynamic(() => import("./PdfViewer"), {
  ssr: false,
  loading: () => <PdfViewerLoading />,
});

interface OfficeViewerProps {
  fileUrl: string;
  fileName: string;
  watermark?: string | null;
  noDownload?: boolean;
  pdfUrl?: string;
  /** Short URL identifier for proxy-based PDF serving */
  shortUrl?: string;
  /**
   * Already-verified password for the preview session identified by
   * `shortUrl` (see PUL-197). Callers must only pass this once the
   * password has been verified — it is never re-checked here, only
   * forwarded to the conversion API so the converted PDF's own proxy
   * output URL can be password-gated the same way as the original file's.
   */
  accessPassword?: string;
}

/**
 * Simplified viewer state for blocking API pattern
 * Requirements: 4.1, 4.2, 4.3
 */
enum ViewerState {
  LOADING = "loading",
  READY = "ready",
  ERROR = "error",
}

/**
 * OfficeViewer - Displays Office documents by converting them to PDF
 *
 * Uses the ConverterPort injected via <ConverterProvider>:
 * 1. Check if PDF is already available (HEAD request)
 * 2. If not, ask the converter to produce a PDF (may be sync or async)
 * 3. Display the PDF using PdfViewer
 */
export default function OfficeViewer({
  fileUrl,
  fileName,
  watermark,
  noDownload,
  pdfUrl: providedPdfUrl,
  shortUrl,
  accessPassword,
}: OfficeViewerProps) {
  const { LL } = useI18n();
  const converter = useConverter();

  // Simplified state - no polling needed with blocking API
  const [state, setState] = useState<ViewerState>(ViewerState.LOADING);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Keep latest values in refs so the effect closure always sees current values
  // without needing them as deps (which would cause the effect to re-run on
  // every render, triggering an infinite conversion loop).
  const converterRef = useRef(converter);
  converterRef.current = converter;
  const LLRef = useRef(LL);
  LLRef.current = LL;
  const fileUrlRef = useRef(fileUrl);
  fileUrlRef.current = fileUrl;
  const fileNameRef = useRef(fileName);
  fileNameRef.current = fileName;
  const shortUrlRef = useRef(shortUrl);
  shortUrlRef.current = shortUrl;
  const accessPasswordRef = useRef(accessPassword);
  accessPasswordRef.current = accessPassword;
  const providedPdfUrlRef = useRef(providedPdfUrl);
  providedPdfUrlRef.current = providedPdfUrl;

  /**
   * Main conversion workflow — runs only when file identity or retryCount changes.
   *
   * All callback values are read from refs inside the effect so we don't need
   * them in the dependency array. This prevents the effect from re-running
   * whenever `LL`, `converter`, or `triggerConversion` get new references
   * (which happens on every render due to object literal / useCallback
   * recreation), which was causing the infinite conversion loop.
   *
   * Stable deps: all values that identify the source or authorize its output,
   * plus retryCount.
   * Everything else is accessed via refs.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — props are mirrored into refs; dep array controls *when* to re-run the effect, not what to read inside it
  useEffect(() => {
    isMountedRef.current = true;

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    const runConversionWorkflow = async () => {
      if (!isMountedRef.current) return;

      setState(ViewerState.LOADING);
      setError(null);

      try {
        // If a PDF URL was explicitly provided, check if it's already available.
        if (providedPdfUrlRef.current) {
          try {
            const response = await fetch(providedPdfUrlRef.current, {
              method: "HEAD",
              cache: "no-store",
            });
            if (!isMountedRef.current || signal.aborted) return;

            if (response.ok) {
              setPdfUrl(providedPdfUrlRef.current);
              setState(ViewerState.READY);
              setError(null);
              return;
            }
            // 404 / 403 = not converted yet — fall through to conversion
          } catch {
            // Network error checking provided PDF — fall through to conversion
          }
        }

        // Trigger blocking conversion via ConverterPort
        const mimeType = getMimeTypeFromFileName(fileNameRef.current);
        const conversionFileUrl = fileUrlRef.current;
        // accessPassword is an explicit, already-verified credential supplied
        // by the caller (see PUL-197/PUL-201) — never inferred from fileUrl,
        // which may be a large-file presigned URL, a direct source URL with
        // an unrelated query string, or otherwise not carry the credential
        // at all. Forward it so the converted PDF's own proxy output URL can
        // be password-gated the same way as the original file's.
        const verifiedPassword = accessPasswordRef.current;

        const metadata: Record<string, unknown> | undefined =
          shortUrlRef.current || verifiedPassword
            ? {
                ...(shortUrlRef.current ? { shortUrl: shortUrlRef.current } : {}),
                ...(verifiedPassword ? { password: verifiedPassword } : {}),
              }
            : undefined;

        const result = await converterRef.current.convertToPdf({
          fileUrl: conversionFileUrl,
          fileName: fileNameRef.current,
          mimeType,
          metadata,
        });

        if (!isMountedRef.current || signal.aborted) return;

        if (!result.pdfUrl) {
          throw new Error(LLRef.current.preview.conversionCompletedNoUrl());
        }

        setPdfUrl(result.pdfUrl);
        setState(ViewerState.READY);
      } catch (err) {
        if (!isMountedRef.current || signal.aborted) return;
        if (err instanceof Error && err.name === "AbortError") return;

        const errorMessage =
          err instanceof Error ? err.message : LLRef.current.preview.failedToLoadDocumentMessage();
        setError(new Error(errorMessage));
        setState(ViewerState.ERROR);
      }
    };

    runConversionWorkflow();

    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
    // Only re-run when the actual file identity or an explicit retry changes.
    // All other values (converter, LL, callbacks) are accessed via refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, fileName, providedPdfUrl, shortUrl, accessPassword, retryCount]);

  /**
   * Handle retry button click
   * Requirements: 4.5 - Error message with retry option
   */
  const handleRetry = useCallback(() => {
    setRetryCount((prev) => prev + 1);
  }, []);

  // Render loading state
  // Requirements: 4.3 - Display simple loading state while blocking request is pending
  // Uses unified LoadingState component for consistent UX
  if (state === ViewerState.LOADING) {
    return (
      <LoadingState
        variant="converting"
        fileName={fileName}
        secondaryMessage={LL.preview.convertingDocumentDesc()}
      />
    );
  }

  // Render error state
  // Requirements: 4.5 - Display error message with retry option
  if (state === ViewerState.ERROR || error) {
    return (
      <div className="w-full h-full flex items-center justify-center p-8">
        <div className="text-center max-w-md space-y-4">
          <AlertCircle className="w-16 h-16 text-destructive mx-auto" />
          <h3 className="text-lg font-semibold">{LL.preview.conversionFailedTitle()}</h3>
          <p className="text-sm text-muted-foreground">
            {error
              ? explainError(LL.preview, error, LL.preview.conversionFailedDesc())
              : LL.preview.conversionFailedDesc()}
          </p>
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleRetry}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              {LL.preview.tryAgain()}
            </button>
            {!noDownload && (
              <div>
                <a
                  href={fileUrl}
                  download={fileName}
                  className="text-sm text-primary hover:underline"
                >
                  {LL.preview.downloadOriginalFile()}
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Render PDF viewer on success
  // Requirements: 4.4 - Render PDF using PdfViewer when request returns successfully
  if (state === ViewerState.READY && pdfUrl) {
    return (
      <PdfViewer
        fileUrl={pdfUrl}
        fileName={fileName}
        watermark={watermark}
        noDownload={noDownload}
      />
    );
  }

  // Fallback loading state
  return <LoadingState message={LL.preview.loadingDocument()} />;
}
