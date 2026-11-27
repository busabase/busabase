"use client";

import { detectFileType, FileType } from "previewfile-core/utils/file-types";
import { AssetMediaPreview } from "./assets";
import { AttachmentHtmlViewer } from "./attachment-html-viewer";
import type { HostFileViewerFile } from "./file-viewer-slot";

/** Host-owned recovery keeps the selected viewer and workspace navigation in place. */
export function AttachmentViewer({ file }: { file: HostFileViewerFile }) {
  const html =
    /\.html?$/i.test(file.name) ||
    (detectFileType({ fileName: file.name, mimeType: "" }) === FileType.UNSUPPORTED &&
      file.mimeType.split(";", 1)[0]?.trim().toLowerCase() === "text/html");
  return (
    <div
      className="h-full min-h-0 min-w-0 overflow-hidden bg-background"
      data-previewfile-type={detectFileType({ fileName: file.name, mimeType: file.mimeType })}
    >
      {html ? (
        <AttachmentHtmlViewer
          key={JSON.stringify([file.url, file.name, file.mimeType, file.size])}
          file={file}
        />
      ) : (
        <AssetMediaPreview
          viewerScope="attachment"
          mediaClassName="h-full max-h-full w-full object-contain"
          mimeType={file.mimeType}
          name={file.name}
          size={file.size}
          url={file.url}
        />
      )}
    </div>
  );
}
