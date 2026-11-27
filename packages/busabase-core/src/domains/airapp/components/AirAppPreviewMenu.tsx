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
import {
  Check,
  ChevronDown,
  Copy,
  Monitor,
  MonitorPlay,
  MoreHorizontal,
  QrCode,
  Smartphone,
} from "lucide-react";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import { airAppToolbarMessages } from "../../../i18n/airapp-toolbar";
import { SHARE_QR_PANEL_CLASS_NAME } from "../../dashboard/components/share-qr-code";
import type { AirAppPreviewState } from "../hooks/use-airapp-preview-state";
import { absolutePreviewUrl, PreviewPhoneContent } from "./AirAppPreviewTools";
import type { AirAppRunnerKind } from "./runners/types";

interface AirAppPreviewMenuProps {
  url: string | null;
  kind: AirAppRunnerKind;
  previewState: AirAppPreviewState;
  primaryAction?: ReactNode;
  header?: ReactNode;
  topItems?: ReactNode;
  extraItems?: ReactNode;
  triggerRef?: Ref<HTMLButtonElement>;
  shareable?: boolean;
  previewAvailable?: boolean;
  showLink?: boolean;
  compact?: boolean;
}

/** Site publication and preview tools stay independent of node-level settings. */
export function AirAppPreviewMenu({
  url,
  kind,
  previewState,
  primaryAction,
  header,
  topItems,
  extraItems,
  triggerRef,
  shareable = false,
  previewAvailable = Boolean(url),
  showLink = true,
  compact = false,
}: AirAppPreviewMenuProps) {
  const messages = useCoreI18n();
  const toolbarCopy = airAppToolbarMessages[useCoreLocale()];
  const copy = messages.airapp.previewTools;
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [copyFailedUrl, setCopyFailedUrl] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [inlineQr, setInlineQr] = useState(false);
  const copyItem = useRef<HTMLDivElement>(null);
  const urlLink = useRef<HTMLAnchorElement>(null);
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
  const qrVisible = qrOpen && !disabled;
  const viewDisabled = !previewAvailable || previewState.refreshing;
  const copyLink = async () => {
    if (!absolute) return;
    try {
      await navigator.clipboard.writeText(absolute);
      setCopiedUrl(absolute);
      setCopyFailedUrl(null);
    } catch {
      setCopiedUrl(null);
      setCopyFailedUrl(absolute);
      if (urlLink.current) {
        urlLink.current.focus();
        const range = document.createRange();
        range.selectNodeContents(urlLink.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  };
  const items = (
    <DropdownMenuGroup
      className="w-64 min-w-0 max-w-[calc(100vw-1.5rem)]"
      data-airapp-preview-menu=""
    >
      {header}
      {primaryAction}
      {topItems}
      <DropdownMenuSeparator />
      {showLink ? (
        <>
          <DropdownMenuLabel>{copy.link}</DropdownMenuLabel>
          <div className="px-2 pb-1">
            <div className="flex min-w-0 items-center gap-1 rounded-sm border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
              <a
                aria-disabled={disabled || undefined}
                aria-label={copy.link}
                className="h-8 min-w-0 flex-1 truncate px-2 font-mono text-xs leading-8 outline-none hover:underline aria-disabled:pointer-events-none aria-disabled:opacity-50"
                dir="ltr"
                href={disabled ? undefined : (absolute ?? undefined)}
                onBlur={(event) => {
                  event.currentTarget.scrollLeft = 0;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") return;
                  event.stopPropagation();
                  if (event.key === "Tab" || event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const menu = copyItem.current?.closest('[role="menu"]');
                    const items = Array.from(
                      menu?.querySelectorAll<HTMLElement>(
                        '[role="menuitem"], [role="menuitemradio"]',
                      ) ?? [],
                    );
                    const index = copyItem.current ? items.indexOf(copyItem.current) : -1;
                    const previous = event.shiftKey || event.key === "ArrowUp";
                    (previous && index > 0 ? items[index - 1] : copyItem.current)?.focus();
                  }
                }}
                ref={urlLink}
                rel="noopener noreferrer"
                role={disabled ? "link" : undefined}
                tabIndex={disabled ? -1 : 0}
                target="_blank"
              >
                {absolute ?? ""}
              </a>
              <DropdownMenuItem
                asChild
                disabled={disabled}
                ref={copyItem}
                onSelect={(event) => {
                  event.preventDefault();
                  void copyLink();
                }}
              >
                <Button
                  aria-label={
                    copiedUrl === absolute && absolute
                      ? messages.airapp.site.releases.copied
                      : copy.copyLink
                  }
                  className="m-0.5 size-7 shrink-0 p-0"
                  disabled={disabled}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  {copiedUrl === absolute && absolute ? <Check /> : <Copy />}
                </Button>
              </DropdownMenuItem>
            </div>
            {shareable && !(inlineQr && qrVisible) ? (
              <p className="pt-1 text-muted-foreground text-xs leading-relaxed">
                {copy.sharedLink}
              </p>
            ) : null}
          </div>
          {copyFailedUrl === absolute && absolute ? (
            <p className="max-w-60 px-2 py-1 text-muted-foreground text-xs" role="status">
              {messages.airapp.site.releases.copyFailed}
            </p>
          ) : null}
        </>
      ) : null}
      {kind !== "site" ? null : inlineQr ? (
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
          {absolute && qrVisible ? (
            <div className="w-full min-w-0 p-2" data-airapp-preview-phone="" ref={qrBody}>
              <PreviewPhoneContent
                kind={kind}
                onClose={() => setQrOpen(false)}
                shareable={shareable}
                url={absolute}
              />
            </div>
          ) : null}
        </>
      ) : (
        <DropdownMenuSub onOpenChange={setQrOpen} open={qrVisible}>
          <DropdownMenuSubTrigger disabled={disabled}>
            <QrCode />
            {copy.phone}
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent
              aria-label={copy.phone}
              className={`${SHARE_QR_PANEL_CLASS_NAME} max-h-[var(--radix-dropdown-menu-content-available-height)]`}
              collisionPadding={12}
              data-airapp-preview-phone=""
            >
              {absolute && qrVisible ? (
                <PreviewPhoneContent kind={kind} shareable={shareable} url={absolute} />
              ) : null}
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
        <DropdownMenuRadioItem disabled={viewDisabled} value="desktop">
          <Monitor className="mr-2" />
          {copy.desktop}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem disabled={viewDisabled} value="mobile">
          <Smartphone className="mr-2" />
          {copy.mobile}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      {extraItems}
    </DropdownMenuGroup>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={compact ? toolbarCopy.moreActions : toolbarCopy.menu}
          className={compact ? "size-8 shrink-0 p-0" : "h-8 shrink-0 gap-1 px-2 text-xs"}
          data-airapp-site-actions=""
          ref={triggerRef}
          size="sm"
          type="button"
          variant="ghost"
        >
          {compact ? (
            <MoreHorizontal aria-hidden="true" className="size-4" />
          ) : (
            <MonitorPlay aria-hidden="true" className="size-3.5" />
          )}
          {compact ? null : <span>{toolbarCopy.menuShort}</span>}
          {compact ? null : <ChevronDown className="size-3.5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-airapp-site-menu="">
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
