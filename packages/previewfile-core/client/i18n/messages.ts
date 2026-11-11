/**
 * Messages — strings displayed by previewfile-core viewers.
 *
 * Defaults are English; `messagesForLocale` (./locales) has the other
 * languages the hosts serve. Each entry is a function so callers can keep the
 * parametrized signature `messages.foo({ name: "x" })`.
 */
export interface Messages {
  loading: () => string;
  loadingFile: () => string;
  loadingDocument: () => string;
  loadingOfficeViewer: () => string;
  loadingAudioViewer: () => string;
  loadingCodeViewer: () => string;
  loadingImageViewer: () => string;
  loadingMarkdownViewer: () => string;
  loadingVideoViewer: () => string;
  loadingPdfViewer: () => string;
  loadingExcelViewer: () => string;
  loadingTiffViewer: () => string;
  loading3dViewer: () => string;
  loadingWordViewer: () => string;
  loadingEpubViewer: () => string;
  loadingPsdViewer: () => string;
  loadingSqliteViewer: () => string;
  loadingSpreadsheetEngine: () => string;

  fileLabel: () => string;
  typeLabel: () => string;
  download: () => string;
  downloadDisabled: () => string;
  downloadIconTitle: () => string;
  downloadFile: (args: { fileName: string }) => string;
  downloadOriginalFile: () => string;

  previousPage: () => string;
  nextPage: () => string;

  pdfLoadErrorTitle: () => string;
  pdfLoadErrorDesc: () => string;

  spreadsheetLoadErrorTitle: () => string;

  failedToLoadDocumentTitle: () => string;
  failedToLoadDocumentMessage: () => string;
  failedToLoadImageTitle: () => string;
  failedToLoadImageDesc: () => string;

  previewNotAvailable: () => string;
  previewNotAvailableDesc: () => string;
  unknownError: () => string;
  tryAgain: () => string;

  archivePreviewTitle: () => string;
  archiveContentsTitle: () => string;
  archiveViewerComingSoon: () => string;

  convertingDocumentDesc: () => string;
  conversionFailedTitle: () => string;
  conversionFailedDesc: () => string;
  conversionCompletedNoUrl: () => string;

  silkUnsupportedTitle: () => string;
  silkUnsupportedDesc: () => string;
  silkDecodeFailedTitle: () => string;
  silkDecodeFailedDesc: () => string;

  // Loading, errors and retry (LoadingState, ErrorState)
  loadingGeneric: () => string;
  convertingGeneric: () => string;
  queuedForConversion: () => string;
  checkingDocument: () => string;
  failedToLoadFile: () => string;
  errorNetwork: () => string;
  errorNotFound: () => string;
  errorForbidden: () => string;
  errorServer: () => string;
  errorTimeout: () => string;
  errorCorrupted: () => string;
  retrying: () => string;
  technicalDetails: () => string;

  // Toolbars and hints (TIFF, PSD, 3D)
  zoomIn: () => string;
  zoomOut: () => string;
  zoomInShortcut: () => string;
  zoomOutShortcut: () => string;
  fitWidth: () => string;
  fitHeight: () => string;
  fitToWidth: () => string;
  fitToHeight: () => string;
  previousPageShortcut: () => string;
  nextPageShortcut: () => string;
  pageOf: (args: { page: number; total: number }) => string;
  zoomTip: () => string;
  zoomAndPagesTip: () => string;
  enterFullscreen: () => string;
  exitFullscreen: () => string;
  resetCamera: () => string;
  model3dControlsHint: () => string;
  sizeLabel: () => string;

  // Audio, WeChat Silk
  loadingAudio: () => string;
  audioLoadFailedTitle: () => string;
  audioLoadFailedDesc: () => string;
  browserNoAudio: () => string;
  decodingSilk: () => string;
  preparingPlayableAudio: () => string;

  // Code, Word, Markdown, PDF
  codeViewerLoadError: () => string;
  /** A very large file is drawn in part. */
  codeTruncated: (args: { shown: string; total: string }) => string;
  mayTakeFewSeconds: () => string;
  loadingMarkdown: () => string;
  loadingPdf: () => string;

  // EPUB
  loadingEbook: () => string;
  epubLoadFailedTitle: () => string;
  epubInvalid: () => string;
  tableOfContents: () => string;
  noChapters: () => string;
  epubNavHint: () => string;

  // 3D models (glTF/OBJ…, STL)
  loading3dModel: () => string;
  model3dLoadFailed: () => string;
  model3dEmpty: () => string;
  largeFileTitle: () => string;
  largeFileDesc: (args: { size: string }) => string;
  loadedPercent: (args: { percent: number }) => string;
  loadingStl: () => string;
  stlLoadFailedTitle: () => string;

  // SQLite
  sqliteNoTables: () => string;
  sqliteRowsColumns: (args: { rows: number; columns: number }) => string;
  sqliteTableCount: (args: { count: number }) => string;
  sqliteTableLabel: () => string;
  sqliteTableOption: (args: { name: string; rows: number }) => string;
  sqliteTableEmpty: (args: { name: string }) => string;
  sqliteColumnFallback: (args: { index: number }) => string;

  // Subtitles
  loadingSubtitles: () => string;
  noSubtitles: () => string;

  // TIFF, PSD
  loadingTiffImage: () => string;
  tiffLoadFailed: () => string;
  tiffNoPages: () => string;
  tiffRenderFailed: () => string;
  loadingPsdImage: () => string;
  psdParseFailed: () => string;
  psdNoComposite: () => string;

  // Video (MPEG / MOV transcoding)
  convertingVideo: () => string;
  videoConvertMayTake: () => string;
  videoConvertedTitle: () => string;
  videoConvertedDesc: () => string;
  videoUnsupportedTitle: () => string;
  downloadVideoFile: () => string;
  videoWhyTitle: () => string;
  videoWhyDesc: () => string;
  videoTranscodeFailed: () => string;
  videoPlayFailed: (args: { detail: string }) => string;

  // Archives
  archiveNoEntries: () => string;
}

export const defaultMessages: Messages = {
  loading: () => "Loading preview...",
  loadingFile: () => "Loading file...",
  loadingDocument: () => "Loading document...",
  loadingOfficeViewer: () => "Loading Office viewer...",
  loadingAudioViewer: () => "Loading audio viewer...",
  loadingCodeViewer: () => "Loading code viewer...",
  loadingImageViewer: () => "Loading image viewer...",
  loadingMarkdownViewer: () => "Loading markdown viewer...",
  loadingVideoViewer: () => "Loading video viewer...",
  loadingPdfViewer: () => "Loading PDF viewer...",
  loadingExcelViewer: () => "Loading spreadsheet viewer...",
  loadingTiffViewer: () => "Loading TIFF viewer...",
  loading3dViewer: () => "Loading 3D viewer...",
  loadingWordViewer: () => "Loading Word document viewer...",
  loadingEpubViewer: () => "Loading EPUB viewer...",
  loadingPsdViewer: () => "Loading PSD viewer...",
  loadingSqliteViewer: () => "Loading SQLite database...",
  loadingSpreadsheetEngine: () => "Loading spreadsheet engine...",

  fileLabel: () => "File:",
  typeLabel: () => "Type:",
  download: () => "Download",
  downloadDisabled: () => "Download is disabled for this file",
  downloadIconTitle: () => "Download icon",
  downloadFile: ({ fileName }) => `Download ${fileName}`,
  downloadOriginalFile: () => "Download original file",

  previousPage: () => "Previous page",
  nextPage: () => "Next page",

  pdfLoadErrorTitle: () => "Failed to load PDF",
  pdfLoadErrorDesc: () => "Please try refreshing the page.",

  spreadsheetLoadErrorTitle: () => "Spreadsheet Load Error",

  failedToLoadDocumentTitle: () => "Failed to Load Document",
  failedToLoadDocumentMessage: () => "Failed to load document",
  failedToLoadImageTitle: () => "Failed to load image",
  failedToLoadImageDesc: () => "The image could not be loaded",

  previewNotAvailable: () => "Preview Not Available",
  previewNotAvailableDesc: () => "This file type cannot be previewed directly in the browser.",
  unknownError: () => "Unknown error",
  tryAgain: () => "Try Again",

  archivePreviewTitle: () => "Archive Preview",
  archiveContentsTitle: () => "Archive contents",
  archiveViewerComingSoon: () =>
    "This archive can't be listed: its name has no archive extension (.zip, .rar, .7z, .tar…).",

  convertingDocumentDesc: () =>
    "Converting your Office document to PDF. This usually takes 10-30 seconds.",
  conversionFailedTitle: () => "Conversion Failed",
  conversionFailedDesc: () => "Could not convert document. Please try again.",
  conversionCompletedNoUrl: () => "Conversion completed but no output URL provided",

  silkUnsupportedTitle: () => "This browser can't play WeChat voice notes",
  silkUnsupportedDesc: () =>
    "Playing them needs WebAssembly SIMD, which this browser does not support. Download the file, or open it in Chrome or Edge.",
  silkDecodeFailedTitle: () => "Could not decode this voice note",
  silkDecodeFailedDesc: () =>
    "This WeChat Silk audio file may be damaged or use a variant the decoder does not support.",

  // Loading, errors and retry (LoadingState, ErrorState)
  loadingGeneric: () => "Loading...",
  convertingGeneric: () => "Converting...",
  queuedForConversion: () => "Queued for conversion...",
  checkingDocument: () => "Checking document...",
  failedToLoadFile: () => "Failed to load file",
  errorNetwork: () => "Unable to connect to the server. Please check your internet connection.",
  errorNotFound: () => "The file could not be found. It may have been moved or deleted.",
  errorForbidden: () => "You don't have permission to access this file.",
  errorServer: () => "The server ran into a problem. Please try again later.",
  errorTimeout: () => "The request took too long. Please try again.",
  errorCorrupted: () => "The file appears to be corrupted or in an unsupported format.",
  retrying: () => "Retrying...",
  technicalDetails: () => "Technical details",
  // Toolbars and hints (TIFF, PSD, 3D)
  zoomIn: () => "Zoom in",
  zoomOut: () => "Zoom out",
  zoomInShortcut: () => "Zoom in (Ctrl/Cmd + +)",
  zoomOutShortcut: () => "Zoom out (Ctrl/Cmd + -)",
  fitWidth: () => "Fit Width",
  fitHeight: () => "Fit Height",
  fitToWidth: () => "Fit to width",
  fitToHeight: () => "Fit to height",
  previousPageShortcut: () => "Previous page (←)",
  nextPageShortcut: () => "Next page (→)",
  pageOf: ({ page, total }) => `Page ${page} of ${total}`,
  zoomTip: () => "💡 Tip: Use Ctrl/Cmd + Scroll to zoom",
  zoomAndPagesTip: () => "💡 Tip: Use Ctrl/Cmd + Scroll to zoom • Arrow keys to navigate pages",
  enterFullscreen: () => "Enter fullscreen",
  exitFullscreen: () => "Exit fullscreen",
  resetCamera: () => "Reset camera",
  model3dControlsHint: () => "Use mouse to rotate • Scroll to zoom • Right-click to pan",
  sizeLabel: () => "Size:",
  // Audio, WeChat Silk
  loadingAudio: () => "Loading audio...",
  audioLoadFailedTitle: () => "Failed to load audio",
  audioLoadFailedDesc: () => "The audio file could not be loaded",
  browserNoAudio: () => "Your browser does not support the audio element.",
  decodingSilk: () => "Decoding WeChat Silk audio...",
  preparingPlayableAudio: () => "Preparing browser-playable audio",
  // Code, Word, Markdown, PDF
  codeViewerLoadError: () => "Error loading code viewer",
  codeTruncated: ({ shown, total }) => `Showing the first ${shown} of ${total} lines.`,
  mayTakeFewSeconds: () => "This may take a few seconds...",
  loadingMarkdown: () => "Loading markdown...",
  loadingPdf: () => "Loading PDF...",
  // EPUB
  loadingEbook: () => "Loading eBook...",
  epubLoadFailedTitle: () => "Failed to load EPUB file",
  epubInvalid: () =>
    "Invalid EPUB file: The file does not appear to be a valid EPUB (ZIP archive).",
  tableOfContents: () => "Table of Contents",
  noChapters: () => "No chapters found",
  epubNavHint: () => "Use arrow keys or buttons to navigate",
  // 3D models (glTF/OBJ…, STL)
  loading3dModel: () => "Loading 3D model...",
  model3dLoadFailed: () => "Failed to load 3D model",
  model3dEmpty: () => "This model has nothing to show.",
  largeFileTitle: () => "Large File Detected",
  largeFileDesc: ({ size }) =>
    `This file is ${size} and may take longer to load. Please be patient.`,
  loadedPercent: ({ percent }) => `${percent}% loaded`,
  loadingStl: () => "Loading STL model...",
  stlLoadFailedTitle: () => "Failed to load STL model",
  // SQLite
  sqliteNoTables: () => "No tables found in database",
  sqliteRowsColumns: ({ rows, columns }) => `${rows} rows × ${columns} columns`,
  sqliteTableCount: ({ count }) => `${count} tables`,
  sqliteTableLabel: () => "Table:",
  sqliteTableOption: ({ name, rows }) => `${name} (${rows} rows)`,
  sqliteTableEmpty: ({ name }) => `Table "${name}" is empty`,
  sqliteColumnFallback: ({ index }) => `Column ${index}`,
  // Subtitles
  loadingSubtitles: () => "Loading subtitles...",
  noSubtitles: () => "No subtitles found or empty file.",
  // TIFF, PSD
  loadingTiffImage: () => "Loading TIFF image...",
  tiffLoadFailed: () => "Failed to load TIFF file",
  tiffNoPages: () => "No pages found in TIFF file",
  tiffRenderFailed: () => "Failed to render TIFF page",
  loadingPsdImage: () => "Loading PSD image...",
  psdParseFailed: () => "Failed to parse PSD file or no canvas data found",
  psdNoComposite: () => "No composite image data in PSD file",
  // Video (MPEG / MOV transcoding)
  convertingVideo: () => "Converting video to MP4...",
  videoConvertMayTake: () => "This may take a moment depending on the file size",
  videoConvertedTitle: () => "Video Converted Successfully",
  videoConvertedDesc: () => "The video has been converted to MP4 for browser playback.",
  videoUnsupportedTitle: () => "Video Format Not Supported",
  downloadVideoFile: () => "Download Video File",
  videoWhyTitle: () => "Why is this happening?",
  videoWhyDesc: () =>
    "This video format (e.g. MPEG or QuickTime/MOV) has limited support in some web browsers. For the best experience, we recommend converting your video to MP4 (H.264) format, which is widely supported across all browsers and devices.",
  videoTranscodeFailed: () =>
    "Failed to transcode video. Your browser may not support the required features. Please try downloading the file and converting it locally.",
  videoPlayFailed: ({ detail }) => `Unable to play this video. Error: ${detail}`,
  // Archives
  archiveNoEntries: () => "No entries",
};
