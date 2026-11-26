"use client";

import { Button } from "kui/button";
import { PopoverContent } from "kui/popover";
import { cn } from "kui/utils";
import { Download, Loader2 } from "lucide-react";
import { type ComponentProps, useEffect, useState } from "react";
import { useCoreI18n } from "../../../i18n";

export const SHARE_QR_PANEL_CLASS_NAME = "w-64 max-w-[calc(100vw-1.5rem)] overflow-y-auto p-3";

/** One portalled surface for public links and private preview links. */
export function ShareQrPopoverContent({
  className,
  ...props
}: ComponentProps<typeof PopoverContent>) {
  return (
    <PopoverContent
      align="end"
      collisionPadding={12}
      sideOffset={8}
      {...props}
      className={cn(
        SHARE_QR_PANEL_CLASS_NAME,
        "max-h-[var(--radix-popover-content-available-height)] motion-reduce:animate-none",
        className,
      )}
      data-share-qr-popover=""
    />
  );
}

interface ShareQrCodeProps {
  url: string;
  loadingLabel?: string;
  imageData?: Record<`data-${string}`, string>;
}

/** The supplied URL is the source of truth for generation, display and download. */
export function ShareQrCode({ url, loadingLabel, imageData }: ShareQrCodeProps) {
  const messages = useCoreI18n();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    url: string;
    attempt: number;
    image?: string;
    failed?: boolean;
  } | null>(null);
  useEffect(() => {
    let active = true;
    const generate = async () => {
      try {
        const { default: QRCode } = await import("qrcode");
        const image = await QRCode.toDataURL(url, {
          errorCorrectionLevel: "M",
          margin: 4,
          width: 512,
          color: { dark: "#000000", light: "#ffffff" },
        });
        if (active) setResult({ url, attempt, image });
      } catch {
        if (active) setResult({ url, attempt, failed: true });
      }
    };
    void generate();
    return () => {
      active = false;
    };
  }, [url, attempt]);
  const current = result?.url === url && result.attempt === attempt ? result : null;
  const image = current?.image;

  const download = () => {
    if (!image) return;
    const anchor = document.createElement("a");
    anchor.href = image;
    anchor.download = "busabase-qr.png";
    anchor.click();
  };

  return (
    <div className="grid justify-items-center gap-2" data-share-qr="">
      {image ? (
        <img
          {...imageData}
          alt={messages.share.qrAlt}
          className="aspect-square w-48 max-w-full bg-white"
          data-share-qr-image=""
          height={192}
          src={image}
          width={192}
        />
      ) : current?.failed ? (
        <div className="grid min-h-48 content-center justify-items-center gap-2 text-center">
          <p className="text-destructive text-xs" role="alert">
            {messages.share.qrFailed}
          </p>
          <Button
            onClick={() => setAttempt((value) => value + 1)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {messages.common.retry}
          </Button>
        </div>
      ) : (
        <div
          aria-label={loadingLabel ?? messages.common.loading}
          className="grid h-48 w-48 max-w-full place-items-center"
          role="status"
        >
          <Loader2 aria-hidden="true" className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <Button
        className="h-8 gap-1.5 px-2 text-xs"
        disabled={!image}
        onClick={download}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Download aria-hidden="true" className="size-3.5" />
        {messages.share.downloadQr}
      </Button>
    </div>
  );
}
