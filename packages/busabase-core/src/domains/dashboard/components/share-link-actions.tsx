"use client";

import { Button } from "kui/button";
import { Download, QrCode, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCoreI18n } from "../../../i18n";

export function ShareLinkActions({ url, title }: { url: string; title: string }) {
  const t = useCoreI18n().share;
  const [qrPreview, setQrPreview] = useState<{ url: string; dataUrl: string } | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const visiblePreview = qrOpen && qrPreview?.url === url ? qrPreview : null;

  useEffect(() => {
    setCanNativeShare(typeof navigator.share === "function");
  }, []);

  const showQr = async () => {
    if (visiblePreview) {
      setQrOpen(false);
      return;
    }
    try {
      const { default: QRCode } = await import("qrcode");
      const dataUrl = await QRCode.toDataURL(url, {
        errorCorrectionLevel: "M",
        margin: 4,
        width: 512,
        color: { dark: "#000000", light: "#ffffff" },
      });
      setQrPreview({ url, dataUrl });
      setQrOpen(true);
    } catch {
      toast.error(t.qrFailed);
    }
  };

  const downloadQr = () => {
    if (!visiblePreview) return;
    const link = document.createElement("a");
    link.href = visiblePreview.dataUrl;
    link.download = "busabase-qr.png";
    link.click();
  };

  const share = async () => {
    try {
      await navigator.share({ title, url });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(t.failed);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          aria-expanded={Boolean(visiblePreview)}
          onClick={() => void showQr()}
          size="sm"
          type="button"
          variant="outline"
        >
          <QrCode aria-hidden="true" className="size-4" />
          {t.qrCode}
        </Button>
        {canNativeShare && (
          <Button onClick={() => void share()} size="sm" type="button" variant="outline">
            <Share2 aria-hidden="true" className="size-4" />
            {t.shareViaDevice}
          </Button>
        )}
      </div>
      {visiblePreview && (
        <div className="flex flex-col items-start gap-3 rounded-md border border-border/70 p-3">
          <img
            alt={t.qrAlt}
            className="aspect-square w-48 max-w-full bg-white p-2"
            height={192}
            src={visiblePreview.dataUrl}
            width={192}
          />
          <Button onClick={downloadQr} size="sm" type="button" variant="outline">
            <Download aria-hidden="true" className="size-4" />
            {t.downloadQr}
          </Button>
        </div>
      )}
    </div>
  );
}
