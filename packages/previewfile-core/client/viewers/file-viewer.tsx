"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { detectFileType, FileType, needsConverter } from "../../utils/file-types";
import {
  I18nAudioViewerLoading,
  I18nCodeViewerLoading,
  I18nEpubViewerLoading,
  I18nExcelViewerLoading,
  I18nFileLoading,
  I18nImageViewerLoading,
  I18nMarkdownViewerLoading,
  I18nOfficeViewerLoading,
  I18nPdfViewerLoading,
  I18nPsdViewerLoading,
  I18nSqliteViewerLoading,
  I18nSubtitleViewerLoading,
  I18nTiffViewerLoading,
  I18nVideoViewerLoading,
  I18nWordViewerLoading,
} from "./I18nLoadingState";
import UnsupportedFileViewer from "./UnsupportedFileViewer";
import type { ViewerProps } from "./viewer-props";

// Every viewer loads on demand: the router itself stays small enough for a
// host to mount in its preview frame up front.
const PdfViewer = dynamic(() => import("./PdfViewer"), {
  ssr: false,
  loading: I18nPdfViewerLoading,
});
const ImageViewer = dynamic(() => import("./ImageViewer"), {
  ssr: false,
  loading: I18nImageViewerLoading,
});
const TiffViewer = dynamic(() => import("./TiffViewer"), {
  ssr: false,
  loading: I18nTiffViewerLoading,
});
const PsdViewer = dynamic(() => import("./PsdViewer"), {
  ssr: false,
  loading: I18nPsdViewerLoading,
});
const VideoViewer = dynamic(() => import("./VideoViewerWithMpegSupport"), {
  ssr: false,
  loading: I18nVideoViewerLoading,
});
const AudioViewer = dynamic(() => import("./AudioViewer"), {
  ssr: false,
  loading: I18nAudioViewerLoading,
});
const SilkAudioViewer = dynamic(() => import("./SilkAudioViewer"), {
  ssr: false,
  loading: I18nAudioViewerLoading,
});
const SrtViewer = dynamic(() => import("./SrtViewer"), {
  ssr: false,
  loading: I18nSubtitleViewerLoading,
});
const XlsxPreview = dynamic(() => import("./XlsxPreview"), {
  ssr: false,
  loading: I18nExcelViewerLoading,
});
const DocxViewer = dynamic(() => import("./DocxViewer"), {
  ssr: false,
  loading: I18nWordViewerLoading,
});
const OfficeViewer = dynamic(() => import("./OfficeViewer"), {
  ssr: false,
  loading: I18nOfficeViewerLoading,
});
const MarkdownViewer = dynamic(() => import("./MarkdownViewer"), {
  ssr: false,
  loading: I18nMarkdownViewerLoading,
});
const CodeViewer = dynamic(() => import("./CodeViewer"), {
  ssr: false,
  loading: I18nCodeViewerLoading,
});
const EpubViewer = dynamic(() => import("./EpubViewer"), {
  ssr: false,
  loading: I18nEpubViewerLoading,
});
const ArchiveViewer = dynamic(() => import("./ArchiveViewer"), {
  ssr: false,
  loading: I18nFileLoading,
});
const SqliteViewer = dynamic(() => import("./SqliteViewer"), {
  ssr: false,
  loading: I18nSqliteViewerLoading,
});

export { FileType };

export interface FileViewerProps {
  url: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
  watermark?: string | null;
  /** Hide the viewers' own download controls (the host may offer its own). */
  noDownload?: boolean;
  /**
   * Convert MPEG and QuickTime/MOV videos to MP4 in the browser (default
   * `true`). It downloads ffmpeg.wasm's ~30 MB core from unpkg.com at run time,
   * so a host that cannot depend on a third-party CDN passes `false`: a video
   * the browser cannot play then gets the "format not supported" state.
   */
  transcodeVideo?: boolean;
  /**
   * The PreviewFile preview session the file belongs to, so a conversion is
   * made for it and its PDF served through the share link. `accessPassword`
   * must already be verified — it is forwarded, never checked here.
   */
  previewSession?: { shortUrl: string; accessPassword?: string };
  /**
   * The 3D model viewer (`previewfile-core/client/viewers/model-3d`). Opt-in
   * because it brings @react-three/fiber's global JSX types into the host's
   * program; without it 3D models get the "unsupported" card.
   */
  model3dViewer?: ComponentType<ViewerProps>;
}

/** Renders a file with the viewer for its type (`detectFileType`). */
export function FileViewer({
  url,
  fileName,
  mimeType,
  watermark,
  fileSize,
  noDownload = false,
  transcodeVideo = true,
  previewSession,
  model3dViewer: Model3DViewer,
}: FileViewerProps) {
  const file = { fileName, mimeType };
  const viewer: ViewerProps = { fileUrl: url, fileName, watermark, noDownload };
  const session = {
    shortUrl: previewSession?.shortUrl,
    accessPassword: previewSession?.accessPassword,
  };

  switch (detectFileType(file)) {
    case FileType.PDF:
      return <PdfViewer {...viewer} />;
    case FileType.IMAGE:
      return <ImageViewer {...viewer} />;
    case FileType.TIFF:
      return <TiffViewer {...viewer} />;
    case FileType.PSD:
      return <PsdViewer {...viewer} />;
    case FileType.VIDEO:
      return (
        <VideoViewer
          fileUrl={url}
          fileName={fileName}
          // A host may only know "application/octet-stream" (a Drive file saved
          // without its type): that is no type to give a player, which would
          // refuse the source unseen. Leave it unsaid and the player works it
          // out from the URL, else lets the browser sniff the bytes.
          mimeType={mimeType.startsWith("video/") ? mimeType : undefined}
          watermark={watermark}
          noDownload={noDownload}
          transcode={transcodeVideo}
        />
      );
    case FileType.AUDIO:
      return <AudioViewer {...viewer} />;
    case FileType.SILK_AUDIO:
      return <SilkAudioViewer {...viewer} />;
    case FileType.SUBTITLE:
      return <SrtViewer fileUrl={url} watermark={watermark} noDownload={noDownload} />;
    case FileType.SPREADSHEET:
      return <XlsxPreview {...viewer} />;
    case FileType.WORD:
    case FileType.PRESENTATION:
      return needsConverter(file) ? (
        <OfficeViewer {...viewer} {...session} />
      ) : (
        <DocxViewer {...viewer} {...session} />
      );
    case FileType.MARKDOWN:
      return (
        <MarkdownViewer
          fileSize={fileSize}
          fileUrl={url}
          watermark={watermark}
          noDownload={noDownload}
        />
      );
    case FileType.CODE:
    case FileType.TEXT:
      return <CodeViewer {...viewer} fileSize={fileSize} mimeType={mimeType} />;
    case FileType.EPUB:
      return <EpubViewer {...viewer} />;
    case FileType.ARCHIVE:
      return <ArchiveViewer {...viewer} />;
    case FileType.SQLITE:
      return <SqliteViewer {...viewer} />;
    case FileType.MODEL_3D:
      if (Model3DViewer) return <Model3DViewer {...viewer} />;
      break;
  }
  return (
    <UnsupportedFileViewer
      fileUrl={url}
      fileName={fileName}
      mimeType={mimeType}
      noDownload={noDownload}
    />
  );
}
