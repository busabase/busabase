"use client";

import { CodeBlock } from "kui/ai-elements/code-block";
import { Button } from "kui/button";
import { MessagesProvider } from "previewfile-core/client/i18n";
import { TextPreviewFrame } from "previewfile-core/client/text-preview";
import { useState } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { HTML_DOCUMENT_SANDBOX } from "../helpers/html";
import type { HostFileViewerFile } from "./file-viewer-slot";

const HIGHLIGHT_MAX_CHARS = 120_000;
const HIGHLIGHT_MAX_LINES = 2000;

/** Above these budgets Shiki would stall the dialog; the full text is still shown. */
const exceedsHighlightBudget = (source: string): boolean => {
  if (source.length > HIGHLIGHT_MAX_CHARS) return true;
  let lines = 1;
  for (let index = source.indexOf("\n"); index !== -1; index = source.indexOf("\n", index + 1)) {
    lines += 1;
    if (lines > HIGHLIGHT_MAX_LINES) return true;
  }
  return false;
};

interface AttachmentHtmlViewerProps {
  file: HostFileViewerFile;
}

/** The shared text read lifecycle, with a rendered/source switch for HTML. */
export function AttachmentHtmlViewer({ file }: AttachmentHtmlViewerProps) {
  const locale = useCoreLocale();
  return (
    <div className="h-full min-h-0 min-w-0" data-testid="attachment-html-viewer">
      <MessagesProvider locale={locale}>
        <TextPreviewFrame fileUrl={file.url} fileSize={file.size}>
          {(content) => <HtmlAttachmentContent content={content} name={file.name} />}
        </TextPreviewFrame>
      </MessagesProvider>
    </div>
  );
}

function HtmlAttachmentContent({ content, name }: { content: string; name: string }) {
  const messages = useCoreI18n();
  const [showSource, setShowSource] = useState(false);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div
        className="flex shrink-0 gap-1 border-b p-2"
        role="group"
        aria-label={messages.richNodes.htmlSource}
      >
        {[false, true].map((source) => (
          <Button
            key={String(source)}
            aria-pressed={showSource === source}
            onClick={() => setShowSource(source)}
            size="sm"
            type="button"
            variant={showSource === source ? "secondary" : "ghost"}
          >
            {source ? messages.recordView.sourceTab : messages.recordView.preview}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!showSource ? (
          // Attachments can come from anonymous form submissions, so they follow
          // the HTML field policy: CSS renders, scripts and forms never run.
          <iframe
            className="block h-full w-full border-0 bg-card"
            data-testid="attachment-html-frame"
            referrerPolicy="no-referrer"
            sandbox={HTML_DOCUMENT_SANDBOX}
            srcDoc={content}
            title={fmt(messages.richNodes.previewFrame, { name })}
          />
        ) : exceedsHighlightBudget(content) ? (
          <>
            <p
              className="p-4 text-muted-foreground text-sm"
              data-testid="attachment-html-source-fallback"
            >
              {messages.richNodes.htmlSourcePlainText}
            </p>
            <pre
              className="m-0 whitespace-pre-wrap break-words p-4 font-mono text-sm leading-relaxed [overflow-wrap:anywhere]"
              data-testid="attachment-text-content"
            >
              {content}
            </pre>
          </>
        ) : (
          <CodeBlock
            className="rounded-none border-0 [&_code]:rounded-none [&_code]:bg-transparent [&_code]:p-0 [&_pre]:rounded-none [&_pre]:border-0"
            code={content}
            data-testid="attachment-text-content"
            language="html"
            showLineNumbers
          />
        )}
      </div>
    </div>
  );
}
