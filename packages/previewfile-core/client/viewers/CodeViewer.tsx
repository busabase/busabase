"use client";

import { CodeBlock } from "kui/ai-elements/code-block";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { detectFileType, FileType } from "../../utils/file-types";
import { useI18n } from "../i18n";
import { LiteralTextSource, SourceModeControls } from "../text-preview/SourceModeControls";
import { TextPreviewFrame } from "../text-preview/TextPreviewFrame";
import { codeLanguage, limitCodePreview } from "./code-preview";
import { useDownloadGuard } from "./download-guard";
import { useViewerLayout } from "./viewer-layout";

interface CodeViewerProps {
  fileUrl: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
  watermark?: string | null;
  noDownload?: boolean;
}

/** Source and plain text share strict, bounded UTF-8 reads with Markdown. */
export default function CodeViewer({
  fileUrl,
  fileName,
  mimeType,
  fileSize,
  watermark,
  noDownload,
}: CodeViewerProps) {
  const { LL } = useI18n();
  const [source, setSource] = useState(false);
  const plainText = detectFileType({ fileName, mimeType }) === FileType.TEXT;
  const guard = useDownloadGuard(noDownload);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = frame.current;
    if (!guard || !element) return;
    const block = (event: Event) => event.preventDefault();
    const events = ["contextmenu", "selectstart", "dragstart", "copy"];
    for (const event of events) element.addEventListener(event, block);
    return () => {
      for (const event of events) element.removeEventListener(event, block);
    };
  }, [guard]);
  const heightClass = useViewerLayout() === "fill" ? "h-full max-h-screen" : "h-[600px]";
  const language = codeLanguage(fileName, mimeType);
  return (
    <div ref={frame} className={`relative min-h-0 w-full ${heightClass}`}>
      <TextPreviewFrame fileUrl={fileUrl} fileSize={fileSize}>
        {(text) => {
          const preview = limitCodePreview(text);
          return (
            <>
              {watermark ? (
                <div className="pointer-events-none absolute inset-0 grid place-items-center font-bold text-4xl text-muted-foreground/20">
                  {watermark}
                </div>
              ) : null}
              <div
                className={`min-h-full min-w-0 overflow-auto ${guard ? "select-none" : ""}`}
                data-code-viewer=""
              >
                {plainText ? (
                  <div className="p-4">
                    <LiteralTextSource text={text} />
                  </div>
                ) : (
                  <>
                    <div className="px-4 pt-4">
                      <SourceModeControls source={source} onChange={setSource} />
                    </div>
                    {source ? (
                      <div className="p-4 pt-0">
                        <LiteralTextSource text={text} />
                      </div>
                    ) : (
                      <div data-testid="attachment-text-content">
                        <CodeBlock
                          className="min-h-full !rounded-none !border-0 !bg-transparent"
                          code={preview.text}
                          language={language as ComponentProps<typeof CodeBlock>["language"]}
                          showLineNumbers
                        />
                        {preview.truncated ? (
                          <p
                            className="border-t bg-muted/50 px-4 py-2 text-muted-foreground text-xs"
                            data-code-truncated=""
                          >
                            {LL.preview.codeTruncated({
                              shown: String(preview.shownLines),
                              total: String(preview.totalLines),
                            })}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          );
        }}
      </TextPreviewFrame>
    </div>
  );
}
