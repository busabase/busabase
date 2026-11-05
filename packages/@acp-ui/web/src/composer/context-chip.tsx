"use client";

import type { AcpResourceContext } from "@acp-ui/core/reduce";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "kui/dialog";
import { FileTextIcon, X } from "lucide-react";
import type { ReactNode } from "react";

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
  return (
    <Dialog>
      <AcpContextChip
        disabled={disabled}
        onRemove={onRemove}
        removeLabel={removeLabel}
        title={context.name}
      >
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={`${inspectLabel}: ${context.name}`}
            className="flex min-w-0 items-center gap-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          >
            <FileTextIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 max-w-60 truncate font-medium">{context.name}</span>
          </button>
        </DialogTrigger>
      </AcpContextChip>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl flex-col overflow-hidden"
      >
        <DialogHeader className="min-w-0 shrink-0">
          <DialogTitle className="max-h-[25vh] overflow-y-auto break-all pr-6">
            {context.name}
          </DialogTitle>
        </DialogHeader>
        <pre
          aria-label={`${contentLabel}: ${context.name}`}
          className="min-h-0 min-w-0 overflow-auto whitespace-pre-wrap break-words font-sans text-sm focus-visible:outline-2 focus-visible:outline-ring [overflow-wrap:anywhere]"
          role="region"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable snapshots need a keyboard focus target.
          tabIndex={0}
        >
          {context.text}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
