/** Renderer boundary for host-composition tests; routing stays in the real host adapter. */
export function LazyEmbeddedFileViewer({
  url,
  fileName,
  mimeType,
}: {
  url: string;
  fileName: string;
  mimeType: string;
}) {
  return (
    <div
      data-testid="embedded-file-preview"
      data-url={url}
      data-file-name={fileName}
      data-mime-type={mimeType}
    />
  );
}
