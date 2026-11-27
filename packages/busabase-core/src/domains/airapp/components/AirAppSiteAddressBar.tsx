"use client";

import { Button } from "kui/button";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import { airAppToolbarMessages } from "../../../i18n/airapp-toolbar";
import { absolutePreviewUrl, selectPreviewUrl } from "./AirAppPreviewTools";

/** The displayed address and its actions always describe the selected Site view. */
export function AirAppSiteAddressBar({
  url,
  label,
  refreshing = false,
  inline = false,
}: {
  url: string | null;
  label: string;
  refreshing?: boolean;
  inline?: boolean;
}) {
  const messages = useCoreI18n();
  const toolbarCopy = airAppToolbarMessages[useCoreLocale()];
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [copyFailedUrl, setCopyFailedUrl] = useState<string | null>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const destinationVersion = useRef(0);
  const absolute =
    typeof window === "undefined" ? null : absolutePreviewUrl(url, window.location.origin);
  // biome-ignore lint/correctness/useExhaustiveDependencies: feedback resets when the selected address changes.
  useEffect(() => {
    destinationVersion.current += 1;
    setCopiedUrl(null);
    setCopyFailedUrl(null);
  }, [absolute]);
  const disabled = !absolute || refreshing;
  const copied = Boolean(absolute && copiedUrl === absolute);
  const copyLabel = copied
    ? messages.airapp.site.releases.copied
    : messages.airapp.previewTools.copyLink;

  const copyAddress = async () => {
    if (!absolute || disabled) return;
    const copyVersion = destinationVersion.current;
    try {
      await navigator.clipboard.writeText(absolute);
      if (copyVersion !== destinationVersion.current || addressInput.current?.value !== absolute)
        return;
      setCopiedUrl(absolute);
      setCopyFailedUrl(null);
    } catch {
      const input = addressInput.current;
      if (copyVersion !== destinationVersion.current || !input || input.value !== absolute) return;
      setCopiedUrl(null);
      setCopyFailedUrl(absolute);
      input.focus();
      selectPreviewUrl(input);
    }
  };

  return (
    <div
      className={
        inline
          ? "ml-auto min-w-32 max-w-sm flex-1"
          : "min-w-0 shrink-0 border-border/60 border-b px-2 py-1.5 @min-[600px]/airapp-toolbar:px-4"
      }
      data-airapp-site-address=""
    >
      <div
        className={
          inline
            ? "flex min-w-0 items-center gap-1 rounded-sm"
            : "flex min-w-0 items-center gap-1 rounded-sm border border-input bg-background focus-within:ring-2 focus-within:ring-ring"
        }
      >
        <input
          aria-label={label}
          className="h-8 min-w-0 flex-1 truncate rounded-sm bg-transparent px-2 font-mono text-foreground/80 text-xs outline-none selection:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring"
          dir="ltr"
          disabled={disabled}
          onBlur={(event) => {
            event.currentTarget.scrollLeft = 0;
          }}
          onClick={(event) => selectPreviewUrl(event.currentTarget)}
          onFocus={(event) => selectPreviewUrl(event.currentTarget)}
          onMouseUp={(event) => event.preventDefault()}
          readOnly
          ref={addressInput}
          title={
            absolute && copyFailedUrl === absolute
              ? messages.airapp.site.releases.copyFailed
              : (absolute ?? label)
          }
          value={absolute ?? ""}
        />
        <Button
          aria-label={copyLabel}
          className="size-8 shrink-0 text-foreground/80 hover:text-foreground"
          disabled={disabled}
          onClick={() => void copyAddress()}
          size="icon-sm"
          title={copyLabel}
          type="button"
          variant="ghost"
        >
          {copied ? (
            <Check aria-hidden="true" className="size-3.5" />
          ) : (
            <Copy aria-hidden="true" className="size-3.5" />
          )}
        </Button>
        <Button
          asChild
          className="mr-0.5 size-8 shrink-0 text-foreground/80 hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
          size="icon-sm"
          variant="ghost"
        >
          <a
            aria-disabled={disabled || undefined}
            aria-label={toolbarCopy.openInNewTab}
            href={disabled ? undefined : (absolute ?? undefined)}
            rel="noopener noreferrer"
            role={disabled ? "link" : undefined}
            tabIndex={disabled ? -1 : 0}
            target="_blank"
            title={toolbarCopy.openInNewTab}
          >
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        </Button>
      </div>
      {absolute && copyFailedUrl === absolute ? (
        <p
          className={inline ? "sr-only" : "pt-1 text-foreground/80 text-xs leading-relaxed"}
          role="status"
        >
          {messages.airapp.site.releases.copyFailed}
        </p>
      ) : null}
    </div>
  );
}
