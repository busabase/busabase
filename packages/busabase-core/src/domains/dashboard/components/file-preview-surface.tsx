"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { CodeBlock } from "kui/ai-elements/code-block";
import { useEffect } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import {
  FILE_NODE_TEXT_PREVIEW_MAX_LINES,
  type FileNodeTextAsset,
  type FileNodeTextKind,
  fileNodeTextContent,
  fileNodeTextKind,
} from "../helpers/file-node-text";
import { AssetMediaPreview, useAssetHostViewer } from "./assets";
import { MarkdownFieldPreview } from "./field-preview";
import { guessFileTreeLanguage } from "./file-tree-browser";
import type { HostFileViewerFile } from "./file-viewer-slot";
import {
  FullscreenPreviewSurface,
  PreviewFullscreenButton,
  type PreviewFullscreenState,
} from "./preview-fullscreen";
import { FileContentSkeleton } from "./skeletons";

export function isFileFullscreenMime(mimeType: string) {
  return (
    mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType === "application/pdf"
  );
}

/** Native media that can go fullscreen, plus anything a host viewer renders. */
export function useFileFullscreenAvailable(file: HostFileViewerFile | null) {
  const hostViewer = useAssetHostViewer(file);
  return Boolean(file && (isFileFullscreenMime(file.mimeType) || hostViewer));
}

/** The File node's asset, when its text may be shown instead of an "Open file" link. */
export interface FilePreviewTextSource {
  orpc: BusabaseQueryUtils;
  asset: FileNodeTextAsset & { id: string };
}

type FilePreviewText = { kind: FileNodeTextKind; content: string };

interface FilePreviewSurfaceProps {
  fullscreenState: PreviewFullscreenState;
  mimeType: string;
  name: string;
  showToolbar?: boolean;
  /** Lets a text File node render its Markdown or code, as a Drive does. */
  textSource?: FilePreviewTextSource;
  url: string;
}

/**
 * A text File node's surface: reads the Markdown or code once on the server and
 * shows it the way a Drive file tree does. Anything it cannot show whole — too
 * long, not UTF-8, a failed read — falls back to the media preview / "Open
 * file" link. Mounted only for text files, so other surfaces need no query
 * client.
 */
function TextFilePreviewSurface({
  kind,
  source,
  ...props
}: FilePreviewSurfaceProps & { kind: FileNodeTextKind; source: FilePreviewTextSource }) {
  const query = useQuery({
    ...source.orpc.assets.readTextLines.queryOptions({
      input: { assetId: source.asset.id, startLine: 1, endLine: FILE_NODE_TEXT_PREVIEW_MAX_LINES },
    }),
    retry: false,
  });
  const content = query.data ? fileNodeTextContent(query.data) : null;
  return (
    <FilePreviewFrame
      {...props}
      hostViewer={false}
      text={content === null ? null : { kind, content }}
      textLoading={query.isLoading}
    />
  );
}

/**
 * Shared File media surface for the detail page and Side Panel. Fullscreen
 * changes classes on this container only, keeping the media element mounted so
 * images, video playback position, and PDF document state survive the round trip.
 */
export function FilePreviewSurface(props: FilePreviewSurfaceProps) {
  const { mimeType, name, textSource, url } = props;
  const hostViewer = useAssetHostViewer({ mimeType, name, url });
  // A host viewer claiming the file (e.g. a CSV as a table) goes first.
  const textKind = textSource && !hostViewer ? fileNodeTextKind(textSource.asset) : null;
  if (textSource && textKind) {
    return <TextFilePreviewSurface {...props} kind={textKind} source={textSource} />;
  }
  return (
    <FilePreviewFrame {...props} hostViewer={Boolean(hostViewer)} text={null} textLoading={false} />
  );
}

function FilePreviewFrame({
  fullscreenState,
  hostViewer,
  mimeType,
  name,
  showToolbar = false,
  text,
  textLoading,
  url,
}: FilePreviewSurfaceProps & {
  hostViewer: boolean;
  text: FilePreviewText | null;
  textLoading: boolean;
}) {
  const messages = useCoreI18n();
  const fullscreenAvailable = isFileFullscreenMime(mimeType) || hostViewer;
  // PDFs, host-rendered documents and text bring their own scrolling, so they
  // take the whole frame instead of sitting in the padded media card.
  const fillsFrame = mimeType === "application/pdf" || hostViewer || textLoading || Boolean(text);
  const effectiveFullscreenState = {
    ...fullscreenState,
    fullscreen: fullscreenAvailable && fullscreenState.fullscreen,
  };

  useEffect(() => {
    if (!fullscreenAvailable && fullscreenState.fullscreen) {
      fullscreenState.setFullscreen(false);
    }
  }, [fullscreenAvailable, fullscreenState.fullscreen, fullscreenState.setFullscreen]);

  return (
    <FullscreenPreviewSurface
      aria-label={fmt(messages.richNodes.previewFrame, { name })}
      bodyClassName={
        effectiveFullscreenState.fullscreen || fillsFrame
          ? "bg-background p-0"
          : "bg-background p-4 md:p-6"
      }
      data-file-fullscreen={effectiveFullscreenState.fullscreen ? "true" : "false"}
      data-file-preview=""
      exitLabel={messages.airapp.exitFullscreen}
      fullscreenState={effectiveFullscreenState}
      toolbar={
        showToolbar ? (
          <div className="flex min-h-11 items-center justify-between gap-2 border-border/60 border-b px-4 py-2">
            <span className="min-w-0 truncate font-medium text-muted-foreground text-xs">
              {name}
            </span>
            <PreviewFullscreenButton
              available={fullscreenAvailable}
              fullscreenState={fullscreenState}
              label={messages.airapp.enterFullscreen}
            />
          </div>
        ) : null
      }
    >
      {textLoading ? (
        <FileContentSkeleton />
      ) : text ? (
        // Rendered as a Drive file tree renders the same file.
        <div className="h-full min-h-0 w-full overflow-auto" data-file-text-preview={text.kind}>
          {text.kind === "markdown" ? (
            <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
              <MarkdownFieldPreview value={text.content} />
            </div>
          ) : (
            <CodeBlock
              className="min-h-full !rounded-none !border-0 !bg-transparent"
              code={text.content}
              language={guessFileTreeLanguage(name)}
              showLineNumbers
            />
          )}
        </div>
      ) : (
        <div
          className={
            effectiveFullscreenState.fullscreen || fillsFrame
              ? "grid h-full min-h-0 w-full place-items-center overflow-hidden bg-background"
              : "mx-auto grid h-full min-h-[320px] max-w-5xl place-items-center overflow-hidden rounded-md border bg-muted"
          }
          data-file-media-frame=""
        >
          <AssetMediaPreview
            mediaClassName={
              effectiveFullscreenState.fullscreen
                ? "h-full max-h-full w-full border-0 object-contain"
                : fillsFrame
                  ? "h-full max-h-full w-full border-0"
                  : "max-h-[65vh] w-full border-0 object-contain"
            }
            mimeType={mimeType}
            name={name}
            url={url}
          />
        </div>
      )}
    </FullscreenPreviewSurface>
  );
}
