"use client";

import { Button } from "kui/button";
import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import { ToggleGroup, ToggleGroupItem } from "kui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "kui/tooltip";
import { cn } from "kui/utils";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Monitor,
  QrCode,
  RotateCw,
  Smartphone,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import type { AirAppPreviewViewport } from "../hooks/use-airapp-preview-state";
import type { AirAppRunnerKind } from "./runners/types";

export type { AirAppPreviewViewport } from "../hooks/use-airapp-preview-state";

/** Share browser-facing URLs only; provider credentials never belong in a QR. */
export const absolutePreviewUrl = (url: string | null, origin: string): string | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url, origin);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed.href
      : null;
  } catch {
    return null;
  }
};

const isLoopback = (url: string): boolean => {
  const host = new URL(url).hostname;
  return (
    host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127\./.test(host)
  );
};

interface AirAppPreviewToolsProps {
  url: string | null;
  kind: AirAppRunnerKind;
  viewport: AirAppPreviewViewport;
  setViewport: (viewport: AirAppPreviewViewport) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshDisabled?: boolean;
  refreshLabel?: string;
}

export function AirAppPreviewTools({
  url,
  kind,
  viewport,
  setViewport,
  onRefresh,
  refreshing = false,
  refreshDisabled = false,
  refreshLabel,
}: AirAppPreviewToolsProps) {
  const messages = useCoreI18n();
  const copy = messages.airapp.previewTools;
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [copyFailedUrl, setCopyFailedUrl] = useState<string | null>(null);
  const absolute =
    typeof window === "undefined" ? null : absolutePreviewUrl(url, window.location.origin);

  return (
    <TooltipProvider delayDuration={350}>
      <div className="flex flex-wrap items-center gap-2" data-airapp-preview-tools="">
        <div className="flex min-w-0 flex-1 basis-64 flex-wrap items-center gap-x-0.5 gap-y-1 rounded-2xl bg-muted/30 p-1">
          <span className="ml-1 shrink-0 rounded-full bg-background px-2 py-1 font-medium text-foreground/70 text-[10px]">
            {copy.link}
          </span>
          <input
            aria-label={copy.link}
            className="h-10 min-w-28 flex-1 rounded-sm bg-transparent px-2 font-mono text-foreground text-xs outline-none selection:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring sm:h-8"
            disabled={!absolute || refreshing}
            onFocus={(event) => event.currentTarget.select()}
            placeholder={copy.link}
            readOnly
            value={absolute ?? ""}
          />
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <span
              aria-hidden="true"
              className="mx-0.5 hidden h-4 w-px shrink-0 bg-border/60 sm:block"
            />
            <PreviewToolTip
              label={
                copiedUrl === absolute && absolute
                  ? messages.airapp.site.releases.copied
                  : copy.copyLink
              }
              suppressed={phoneOpen}
            >
              <Button
                aria-label={
                  copiedUrl === absolute && absolute
                    ? messages.airapp.site.releases.copied
                    : copy.copyLink
                }
                className="size-10 shrink-0 text-muted-foreground hover:text-foreground sm:size-8"
                disabled={!absolute || refreshing}
                onClick={async () => {
                  if (!absolute) return;
                  try {
                    await navigator.clipboard.writeText(absolute);
                    setCopiedUrl(absolute);
                    setCopyFailedUrl(null);
                  } catch {
                    setCopiedUrl(null);
                    setCopyFailedUrl(absolute);
                  }
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                {copiedUrl === absolute && absolute ? (
                  <Check aria-hidden="true" className="size-3.5" />
                ) : (
                  <Copy aria-hidden="true" className="size-3.5" />
                )}
              </Button>
            </PreviewToolTip>
            <PreviewToolTip label={copy.newWindow} suppressed={phoneOpen}>
              <Button
                aria-label={copy.newWindow}
                className="size-10 shrink-0 text-muted-foreground hover:text-foreground sm:size-8"
                disabled={!absolute || refreshing}
                onClick={() => {
                  if (absolute) window.open(absolute, "_blank", "noopener,noreferrer,popup");
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </Button>
            </PreviewToolTip>
            <Popover onOpenChange={setPhoneOpen} open={Boolean(absolute && phoneOpen)}>
              <PreviewToolTip label={copy.phone} suppressed={phoneOpen}>
                <PopoverTrigger asChild>
                  <Button
                    aria-label={copy.phone}
                    className="size-10 shrink-0 text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground sm:size-8"
                    disabled={!absolute || refreshing}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <QrCode aria-hidden="true" className="size-3.5" />
                  </Button>
                </PopoverTrigger>
              </PreviewToolTip>
              {absolute && phoneOpen ? (
                <PreviewPhonePopup kind={kind} onClose={() => setPhoneOpen(false)} url={absolute} />
              ) : null}
            </Popover>
            {onRefresh ? (
              <PreviewToolTip
                label={refreshLabel ?? messages.airapp.site.publish.refreshPreview}
                suppressed={phoneOpen}
              >
                <Button
                  aria-label={refreshLabel ?? messages.airapp.site.publish.refreshPreview}
                  aria-busy={refreshing}
                  className="size-10 shrink-0 rounded-full text-muted-foreground hover:text-foreground sm:size-8"
                  disabled={!absolute || refreshing || refreshDisabled}
                  onClick={onRefresh}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  {refreshing ? (
                    <Loader2
                      aria-hidden="true"
                      className="size-3.5 animate-spin motion-reduce:animate-none"
                    />
                  ) : (
                    <RotateCw aria-hidden="true" className="size-3.5" />
                  )}
                </Button>
              </PreviewToolTip>
            ) : null}
          </div>
        </div>
        <ToggleGroup
          aria-label={copy.viewport}
          className="grid shrink-0 grid-cols-2 gap-0.5 rounded-md bg-muted/50 p-0.5"
          disabled={!absolute || refreshing}
          onValueChange={(device) => {
            if (device === "desktop" || device === "mobile") setViewport(device);
          }}
          type="single"
          value={viewport}
        >
          {(["desktop", "mobile"] as const).map((device) => (
            <ToggleGroupItem
              aria-label={device === "desktop" ? copy.desktop : copy.mobile}
              className="h-10 min-w-20 gap-1.5 rounded-sm border border-transparent px-2 text-foreground/70 text-xs hover:text-foreground data-[state=on]:border-border/60 data-[state=on]:bg-background data-[state=on]:text-foreground sm:h-8"
              key={device}
              type="button"
              value={device}
            >
              {device === "desktop" ? (
                <Monitor aria-hidden="true" className="size-3.5" />
              ) : (
                <Smartphone aria-hidden="true" className="size-3.5" />
              )}
              <span>{device === "desktop" ? copy.desktop : copy.mobile}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {copyFailedUrl === absolute && absolute ? (
          <p className="w-full text-muted-foreground text-xs" role="status">
            {messages.airapp.site.releases.copyFailed}
          </p>
        ) : null}
        <span className="sr-only" role="status">
          {copiedUrl === absolute && absolute ? messages.airapp.site.releases.copied : null}
        </span>
      </div>
    </TooltipProvider>
  );
}

function PreviewToolTip({
  label,
  children,
  suppressed,
}: {
  label: string;
  children: ReactNode;
  suppressed: boolean;
}) {
  return (
    <Tooltip open={suppressed ? false : undefined}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-64 text-xs" side="top">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function PreviewPhonePopup(props: { url: string; kind: AirAppRunnerKind; onClose: () => void }) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <PopoverContent
      align="end"
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto p-3 motion-reduce:animate-none"
      collisionPadding={12}
      data-airapp-preview-phone=""
      sideOffset={8}
    >
      <PreviewPhoneContent {...props} descriptionId={descriptionId} titleId={titleId} />
    </PopoverContent>
  );
}

export function PreviewPhoneContent({
  url,
  kind,
  onClose,
  titleId,
  descriptionId,
}: {
  url: string;
  kind: AirAppRunnerKind;
  onClose?: () => void;
  titleId?: string;
  descriptionId?: string;
}) {
  const messages = useCoreI18n();
  const copy = messages.airapp.previewTools;
  const browserOnly = kind === "browser";
  const [qr, setQr] = useState<{ url: string; image: string } | null>(null);
  const [qrError, setQrError] = useState(false);

  useEffect(() => {
    if (browserOnly) return;
    let cancelled = false;
    setQrError(false);
    const generate = async () => {
      try {
        const { default: QRCode } = await import("qrcode");
        const image = await QRCode.toDataURL(url, {
          errorCorrectionLevel: "M",
          margin: 4,
          width: 512,
        });
        if (!cancelled) setQr({ url, image });
      } catch {
        if (!cancelled) setQrError(true);
      }
    };
    void generate();
    return () => {
      cancelled = true;
    };
  }, [url, browserOnly]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-sm" id={titleId}>
          {copy.phone}
        </h3>
        {onClose ? (
          <Button
            aria-label={messages.common.close}
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" className="size-3.5" />
          </Button>
        ) : null}
      </div>
      {!browserOnly ? (
        qr?.url === url ? (
          <img
            alt={messages.share.qrAlt}
            className="mx-auto aspect-square w-48 max-w-full rounded-sm"
            data-airapp-preview-qr=""
            height={192}
            src={qr.image}
            width={192}
          />
        ) : qrError ? (
          <p className="text-destructive text-sm" role="alert">
            {messages.share.qrFailed}
          </p>
        ) : (
          <div aria-label={copy.loadingQr} className="grid h-48 place-items-center" role="status">
            <Loader2 aria-hidden="true" className="size-5 animate-spin text-muted-foreground" />
          </div>
        )
      ) : null}
      <p className="text-muted-foreground text-xs leading-relaxed" id={descriptionId}>
        {browserOnly ? copy.browserOnly : copy.signIn}
      </p>
      {!browserOnly && isLoopback(url) ? (
        <p className="rounded-sm bg-muted/40 p-2 text-muted-foreground text-xs leading-relaxed">
          {copy.loopback}
        </p>
      ) : null}
    </div>
  );
}

/** The iframe stays at the same React position while only its viewport changes. */
export function AirAppPreviewFrame({
  viewport,
  children,
  className,
}: {
  viewport: AirAppPreviewViewport;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 justify-center overflow-auto",
        viewport === "mobile" && "bg-muted/30 p-3",
        className,
      )}
      data-airapp-preview-viewport={viewport}
    >
      <div
        className={cn(
          "h-full min-h-0 shrink-0 overflow-hidden",
          viewport === "mobile" ? "w-96 max-w-full rounded-xl border border-border" : "w-full",
        )}
      >
        {children}
      </div>
    </div>
  );
}
