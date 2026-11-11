"use client";

import { LazyEmbeddedFileViewer } from "previewfile-core/client/embedded/lazy";
import { Model3DViewer } from "previewfile-core/client/viewers/model-3d";
import type { ConverterPort } from "previewfile-core/types/ports";
import { canPreview, detectFileType, FileType } from "previewfile-core/utils/file-types";
import type { HostFileViewer } from "./file-viewer-slot";

interface PreviewFileHostOptions {
  locale: string;
  converter?: ConverterPort;
  officeConversion?: boolean;
}

/** One lazy viewer adapter for OSS and Cloud; hosts supply capabilities only. */
export const createPreviewFileHostViewer = ({
  locale,
  converter,
  officeConversion = false,
}: PreviewFileHostOptions): HostFileViewer => ({
  canRender: ({ name, mimeType }) =>
    canPreview({ fileName: name, mimeType }, { officeConversion, model3d: true }),
  canRenderInline: ({ name, mimeType }) => {
    const file = { fileName: name, mimeType };
    const type = detectFileType(file);
    // The File node owns native images and its server-backed text surface.
    return (
      type !== FileType.IMAGE &&
      type !== FileType.CODE &&
      type !== FileType.TEXT &&
      type !== FileType.MARKDOWN &&
      canPreview(file, { officeConversion, model3d: true })
    );
  },
  render: ({ name, mimeType, url, size }) => (
    <LazyEmbeddedFileViewer
      converter={converter}
      fileName={name}
      fileSize={size}
      locale={locale}
      mimeType={mimeType}
      model3dViewer={Model3DViewer}
      noDownload={detectFileType({ fileName: name, mimeType }) !== FileType.VIDEO}
      url={url}
    />
  ),
});
