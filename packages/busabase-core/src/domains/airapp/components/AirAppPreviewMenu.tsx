"use client";

import { Button } from "kui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "kui/tooltip";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  Monitor,
  QrCode,
  RotateCw,
  Smartphone,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import type { AirAppPreviewState } from "../hooks/use-airapp-preview-state";
import { absolutePreviewUrl, PreviewPhoneContent } from "./AirAppPreviewTools";
import type { AirAppRunnerKind } from "./runners/types";

interface AirAppPreviewMenuProps {
  url: string | null;
  kind: AirAppRunnerKind;
  previewState: AirAppPreviewState;
  topItems?: ReactNode;
  extraItems?: ReactNode;
}

/** Site publication and preview tools stay independent of node-level settings. */
export function AirAppPreviewMenu({
  url,
  kind,
  previewState,
  topItems,
  extraItems,
}: AirAppPreviewMenuProps) {
  const messages = useCoreI18n();
  const copy = messages.airapp.previewTools;
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [copyFailedUrl, setCopyFailedUrl] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [inlineQr, setInlineQr] = useState(false);
  const copyItem = useRef<HTMLDivElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const qrBody = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(max-width: 639px)");
    const update = () => setInlineQr(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (inlineQr && qrOpen) qrBody.current?.scrollIntoView({ block: "nearest" });
  }, [inlineQr, qrOpen]);
  const absolute =
    typeof window === "undefined" ? null : absolutePreviewUrl(url, window.location.origin);
  const disabled = !absolute || previewState.refreshing;
  const copyLink = async () => {
    if (!absolute) return;
    try {
      await navigator.clipboard.writeText(absolute);
      setCopiedUrl(absolute);
      setCopyFailedUrl(null);
    } catch {
      setCopiedUrl(null);
      setCopyFailedUrl(absolute);
      urlInput.current?.focus();
      urlInput.current?.select();
    }
  };
  const items = (
    <DropdownMenuGroup
      className="w-64 min-w-0 max-w-[calc(100vw-1.5rem)]"
      data-airapp-preview-menu=""
    >
      {topItems}
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{copy.link}</DropdownMenuLabel>
      <div className="px-2 pb-1">
        <input
          aria-label={copy.link}
          className="h-8 w-56 max-w-[70vw] rounded-sm border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={disabled}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === "Escape") return;
            event.stopPropagation();
            if (event.key === "Tab" || event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const menu = copyItem.current?.closest('[role="menu"]');
              const items = Array.from(
                menu?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ??
                  [],
              );
              const index = copyItem.current ? items.indexOf(copyItem.current) : -1;
              const previous = event.shiftKey || event.key === "ArrowUp";
              (previous && index > 0 ? items[index - 1] : copyItem.current)?.focus();
            }
          }}
          readOnly
          ref={urlInput}
          value={absolute ?? ""}
        />
      </div>
      <DropdownMenuItem
        disabled={disabled}
        ref={copyItem}
        onSelect={(event) => {
          event.preventDefault();
          void copyLink();
        }}
      >
        {copiedUrl === absolute && absolute ? <Check /> : <Copy />}
        {copiedUrl === absolute && absolute ? messages.airapp.site.releases.copied : copy.copyLink}
      </DropdownMenuItem>
      {copyFailedUrl === absolute && absolute ? (
        <p className="max-w-60 px-2 py-1 text-muted-foreground text-xs" role="status">
          {messages.airapp.site.releases.copyFailed}
        </p>
      ) : null}
      {inlineQr ? (
        <>
          <DropdownMenuItem
            disabled={disabled}
            onSelect={(event) => {
              event.preventDefault();
              setQrOpen((open) => !open);
            }}
          >
            <QrCode />
            {copy.phone}
          </DropdownMenuItem>
          {absolute && qrOpen ? (
            <div className="w-full min-w-0 p-2" data-airapp-preview-phone="" ref={qrBody}>
              <PreviewPhoneContent kind={kind} onClose={() => setQrOpen(false)} url={absolute} />
            </div>
          ) : null}
        </>
      ) : (
        <DropdownMenuSub onOpenChange={setQrOpen} open={qrOpen}>
          <DropdownMenuSubTrigger disabled={disabled}>
            <QrCode />
            {copy.phone}
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent
              aria-label={copy.phone}
              className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto p-3"
              collisionPadding={12}
              data-airapp-preview-phone=""
            >
              {absolute && qrOpen ? <PreviewPhoneContent kind={kind} url={absolute} /> : null}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{copy.viewport}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        onValueChange={(value) => {
          if (value === "desktop" || value === "mobile") previewState.setViewport(value);
        }}
        value={previewState.viewport}
      >
        <DropdownMenuRadioItem disabled={disabled} value="desktop">
          <Monitor className="mr-2" />
          {copy.desktop}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem disabled={disabled} value="mobile">
          <Smartphone className="mr-2" />
          {copy.mobile}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuItem disabled={disabled} onSelect={() => previewState.refresh()}>
        {previewState.refreshing ? <Loader2 className="animate-spin" /> : <RotateCw />}
        {messages.airapp.site.publish.refreshPreview}
      </DropdownMenuItem>
      {extraItems}
    </DropdownMenuGroup>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Sites"
          className="h-8 shrink-0 gap-1 px-2 text-xs"
          data-airapp-site-actions=""
          size="sm"
          type="button"
          variant="ghost"
        >
          <span>Sites</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-airapp-site-menu="">
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AirAppPreviewExternalButton({ url }: { url: string | null }) {
  const copy = useCoreI18n().airapp.previewTools;
  const absolute =
    typeof window === "undefined" ? null : absolutePreviewUrl(url, window.location.origin);
  return (
    <TooltipProvider delayDuration={350}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={copy.newWindow}
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            disabled={!absolute}
            onClick={() => {
              if (absolute) window.open(absolute, "_blank", "noopener,noreferrer,popup");
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent className="text-xs">{copy.newWindow}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
