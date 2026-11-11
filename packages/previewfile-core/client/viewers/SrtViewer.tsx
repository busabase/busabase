"use client";

import { useFileFetch } from "previewfile-core/client/file-fetch";
import { useCallback, useEffect, useState } from "react";
import srtParser2 from "srt-parser-2";
import { isWebVtt, vttToSrt } from "../../utils/subtitles";
import { useI18n } from "../i18n";
import { useDownloadGuard } from "./download-guard";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { useViewerHeightClass } from "./viewer-layout";

interface SrtViewerProps {
  fileUrl: string;
  watermark?: string | null;
  noDownload?: boolean;
}

interface SrtItem {
  id: string;
  startTime: string;
  endTime: string;
  text: string;
}

export default function SrtViewer({ fileUrl, watermark, noDownload }: SrtViewerProps) {
  const { LL } = useI18n();
  const heightClass = useViewerHeightClass();
  // Embedded (`fill`), `noDownload` only means the host shows its own download
  // button: the copy/save/print guard — page-wide listeners — is for a share
  // link that forbids downloading, never for the host's page.
  const guardContent = useDownloadGuard(noDownload);
  // Use centralized file fetch hook
  const { data: text, loading: fetchLoading, error: fetchError } = useFileFetch(fileUrl, "text");

  const [items, setItems] = useState<SrtItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Parse SRT content when text is available
  const parseSrt = useCallback((srtText: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const parser = new srtParser2();
      const srtArray = parser.fromSrt(isWebVtt(srtText) ? vttToSrt(srtText) : srtText);
      setItems(srtArray as SrtItem[]);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Parse SRT when text is fetched
  useEffect(() => {
    // Handle fetch errors
    if (fetchError) {
      setError(fetchError);
      setIsLoading(false);
      return;
    }

    // Wait for text to be fetched
    if (fetchLoading || text === null || text === undefined) {
      setIsLoading(true);
      return;
    }

    parseSrt(text);
  }, [text, fetchLoading, fetchError, parseSrt]);

  if (isLoading) {
    return <LoadingState message={LL.preview.loadingSubtitles()} />;
  }

  if (error) {
    return <ErrorState error={error} onRetry={() => window.location.reload()} />;
  }

  return (
    <div className={`w-full ${heightClass} bg-muted relative overflow-auto`}>
      {watermark && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-45deg] text-6xl font-bold text-black/10 select-none pointer-events-none whitespace-nowrap z-10">
          {watermark}
        </div>
      )}

      <div className={`p-8 max-w-4xl mx-auto ${guardContent ? "select-none" : ""}`}>
        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.id} className="bg-background rounded-lg p-4 shadow-sm border">
              <div className="flex justify-between items-center mb-2 text-sm text-muted-foreground">
                <span className="font-mono">#{item.id}</span>
                <span className="font-mono">
                  {item.startTime} --&gt; {item.endTime}
                </span>
              </div>
              <p className="text-lg whitespace-pre-wrap leading-relaxed">{item.text}</p>
            </div>
          ))}
          {items.length === 0 && (
            <div className="text-center text-muted-foreground py-12">
              {LL.preview.noSubtitles()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
