"use client";

import type { ReactNode } from "react";
import { useI18n } from "../i18n";
import { textAttachmentCopy } from "./copy";
import { useTextAttachment } from "./use-text-preview";

/** One read lifecycle and status surface for Markdown, source code and plain text. */
export function TextPreviewFrame({
  fileUrl,
  fileSize = 0,
  markdown = false,
  children,
}: {
  fileUrl: string;
  fileSize?: number;
  markdown?: boolean;
  children: (content: string) => ReactNode;
}) {
  const { language, LL } = useI18n();
  const copy = textAttachmentCopy(language);
  const { state, retry } = useTextAttachment(fileUrl, fileSize);
  return (
    <div
      className="h-full min-h-0 min-w-0 overflow-auto bg-background"
      aria-busy={state.status === "loading"}
      data-testid={markdown ? "attachment-markdown-preview" : "attachment-text-preview"}
      data-text-state={state.status}
      data-markdown-state={markdown ? state.status : undefined}
    >
      {state.status === "loading" ? (
        <p className="p-4 text-muted-foreground text-sm" role="status">
          {copy.loading}
        </p>
      ) : state.status === "error" ? (
        <div className="space-y-3 p-4">
          <p className="text-muted-foreground text-sm" role="alert">
            {state.error === "tooLarge"
              ? copy.tooLarge.replace("{limit}", "1 MiB")
              : copy[state.error]}
          </p>
          {state.error === "failed" || state.error === "timedOut" ? (
            <button
              type="button"
              className="rounded-md border px-3 py-2 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={retry}
            >
              {LL.preview.tryAgain()}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {state.content.length === 0 ? (
            <p role="status" className="p-4 text-muted-foreground text-sm">
              {copy.empty}
            </p>
          ) : null}
          {children(state.content)}
        </>
      )}
    </div>
  );
}
