"use client";

import { markdownPreviewSource } from "openlib/utils/markdown-preview";
import { useState } from "react";
import { Streamdown } from "streamdown";
import { LiteralTextSource, SourceModeControls } from "../text-preview/SourceModeControls";
import { TextPreviewFrame } from "../text-preview/TextPreviewFrame";
import { useDownloadGuard } from "./download-guard";

interface MarkdownViewerProps {
  fileUrl: string;
  fileSize?: number;
  watermark?: string | null;
  noDownload?: boolean;
}

/** The shared Markdown engine with literal source and bounded original-file reads. */
export default function MarkdownViewer({
  fileUrl,
  fileSize,
  watermark,
  noDownload,
}: MarkdownViewerProps) {
  const [source, setSource] = useState(false);
  const guard = useDownloadGuard(noDownload);
  return (
    <TextPreviewFrame fileUrl={fileUrl} fileSize={fileSize} markdown>
      {(text) => (
        <div className={`relative mx-auto max-w-4xl p-4 ${guard ? "select-none" : ""}`}>
          {watermark ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center font-bold text-4xl text-muted-foreground/20">
              {watermark}
            </div>
          ) : null}
          <SourceModeControls source={source} onChange={setSource} />
          {source ? (
            <LiteralTextSource text={text} />
          ) : (
            <Streamdown
              className="min-w-0 break-words text-sm leading-7 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              controls={false}
              linkSafety={{ enabled: false }}
              mode="static"
            >
              {markdownPreviewSource(text)}
            </Streamdown>
          )}
        </div>
      )}
    </TextPreviewFrame>
  );
}
