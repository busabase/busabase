"use client";

import type { AcpResourceContext } from "@acp-ui/core/reduce";
import { FileTextIcon, X } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

export function AcpContextChip({
  children,
  onRemove,
  removeLabel = "Remove",
  title,
  disabled = false,
}: {
  children: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <div
      aria-label={title}
      className="group relative flex h-7 min-w-0 max-w-full items-center gap-1 rounded-md border bg-muted/50 px-2 text-foreground text-xs"
      role="group"
      title={title}
    >
      {children}
      {onRemove ? (
        <button
          disabled={disabled}
          aria-label={removeLabel}
          className="absolute -top-2 -right-2 z-10 inline-flex size-5 items-center justify-center rounded-full border-2 border-background bg-foreground text-background opacity-0 transition-opacity after:absolute after:-inset-2 after:content-[''] group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          title={removeLabel}
          type="button"
        >
          <X className="size-2.5" />
        </button>
      ) : null}
    </div>
  );
}

/** A context snapshot is inspected locally. Opening it never dereferences its URI. */
export function AcpResourceContextChip({
  context,
  onRemove,
  disabled = false,
  inspectLabel = "Inspect context",
  removeLabel = "Remove context",
  contentLabel = "Context content",
}: {
  context: AcpResourceContext;
  onRemove?: () => void;
  disabled?: boolean;
  inspectLabel?: string;
  removeLabel?: string;
  contentLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <>
      <AcpContextChip
        disabled={disabled}
        onRemove={onRemove}
        removeLabel={removeLabel}
        title={context.name}
      >
        <button
          type="button"
          aria-label={`${inspectLabel}: ${context.name}`}
          aria-expanded={open}
          aria-controls={open ? contentId : undefined}
          className="flex min-w-0 items-center gap-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          onClick={() => setOpen(!open)}
        >
          <FileTextIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 max-w-60 truncate font-medium">{context.name}</span>
        </button>
      </AcpContextChip>
      {open ? (
        <div
          id={contentId}
          aria-label={`${contentLabel}: ${context.name}`}
          className="w-full"
          role="region"
        >
          <textarea
            aria-label={`${contentLabel}: ${context.name}`}
            className="h-56 max-h-72 w-full resize-y overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-3 font-sans text-sm focus-visible:outline-2 focus-visible:outline-ring [overflow-wrap:anywhere]"
            readOnly
            value={context.text}
          />
        </div>
      ) : null}
    </>
  );
}
