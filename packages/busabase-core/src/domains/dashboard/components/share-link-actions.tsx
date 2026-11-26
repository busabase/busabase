"use client";

import { Button } from "kui/button";
import { Popover, PopoverTrigger } from "kui/popover";
import { QrCode, Share2, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useCoreI18n } from "../../../i18n";
import { ShareQrCode, ShareQrPopoverContent } from "./share-qr-code";

export function ShareLinkActions({
  url,
  title,
  compact = false,
  description,
}: {
  url: string;
  title: string;
  compact?: boolean;
  description?: string;
}) {
  const messages = useCoreI18n();
  const t = messages.share;
  const [qrOpen, setQrOpen] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    setCanNativeShare(typeof navigator.share === "function");
  }, []);

  const share = async () => {
    try {
      await navigator.share({ title, url });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(t.failed);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1" data-share-link-actions="">
      <Popover onOpenChange={setQrOpen} open={qrOpen}>
        <PopoverTrigger asChild>
          <Button
            aria-label={t.qrCode}
            className={
              compact ? "size-8 shrink-0 text-muted-foreground hover:text-foreground" : undefined
            }
            size={compact ? "icon-sm" : "sm"}
            title={compact ? t.qrCode : undefined}
            type="button"
            variant={compact ? "ghost" : "outline"}
          >
            <QrCode aria-hidden="true" className="size-3.5" />
            {!compact ? t.qrCode : null}
          </Button>
        </PopoverTrigger>
        <ShareQrPopoverContent
          aria-describedby={description ? descriptionId : undefined}
          aria-labelledby={titleId}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-medium text-sm" id={titleId}>
              {t.qrCode}
            </h3>
            <Button
              aria-label={messages.common.close}
              className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setQrOpen(false)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" className="size-3.5" />
            </Button>
          </div>
          {qrOpen ? <ShareQrCode url={url} /> : null}
          {description ? (
            <p className="mt-3 text-muted-foreground text-xs leading-relaxed" id={descriptionId}>
              {description}
            </p>
          ) : null}
        </ShareQrPopoverContent>
      </Popover>
      {canNativeShare ? (
        <Button
          aria-label={t.shareViaDevice}
          className={
            compact ? "size-8 shrink-0 text-muted-foreground hover:text-foreground" : undefined
          }
          onClick={() => void share()}
          size={compact ? "icon-sm" : "sm"}
          title={compact ? t.shareViaDevice : undefined}
          type="button"
          variant={compact ? "ghost" : "outline"}
        >
          <Share2 aria-hidden="true" className="size-3.5" />
          {!compact ? t.shareViaDevice : null}
        </Button>
      ) : null}
    </div>
  );
}
