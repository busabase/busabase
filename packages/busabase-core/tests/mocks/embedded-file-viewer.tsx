/** Renderer boundary for host-composition tests; routing stays in the real host adapter. */
export function LazyEmbeddedFileViewer({
  url,
  fileName,
  mimeType,
  fitToContainer,
  pdfScrollMode,
}: {
  url: string;
  fileName: string;
  mimeType: string;
  fitToContainer?: boolean;
  pdfScrollMode?: "single" | "continuous";
}) {
  return (
    <div
      data-testid="embedded-file-preview"
      data-url={url}
      data-file-name={fileName}
      data-mime-type={mimeType}
      data-fit-to-container={String(fitToContainer)}
      data-pdf-scroll-mode={String(pdfScrollMode)}
    />
  );
}
