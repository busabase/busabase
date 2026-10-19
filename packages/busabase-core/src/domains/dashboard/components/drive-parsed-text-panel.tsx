import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Button } from "kui/button";
import { FileText, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { AssetTextStatusChip } from "./assets";

const TEXT_WINDOW_SIZE = 500;

export interface DriveParsedTextPayload {
  assetId: string;
  filePath: string;
}

export function DriveParsedTextPanel({
  orpc,
  assetId,
  filePath,
}: DriveParsedTextPayload & { orpc: BusabaseQueryUtils }) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const [range, setRange] = useState({ startLine: 1, endLine: TEXT_WINDOW_SIZE });
  const [lines, setLines] = useState<string[]>([]);
  const [loadedThrough, setLoadedThrough] = useState(0);
  const [totalLines, setTotalLines] = useState<number | null>(null);

  const assetQuery = useQuery({
    ...orpc.assets.get.queryOptions({ input: { assetId } }),
    enabled: Boolean(assetId),
  });
  const textStatus = assetQuery.data?.asset.textStatus;
  const textQuery = useQuery({
    ...orpc.assets.readTextLines.queryOptions({
      input: { assetId, startLine: range.startLine, endLine: range.endLine },
    }),
    enabled: textStatus === "present",
  });

  useEffect(() => {
    const data = textQuery.data;
    if (!data || data.startLine <= loadedThrough) return;
    setLines((current) => [...current, ...data.lines]);
    setLoadedThrough(data.endLine);
    setTotalLines(data.totalLines);
  }, [loadedThrough, textQuery.data]);

  const hasMore = totalLines !== null && loadedThrough < totalLines;

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" data-drive-parsed-text="">
      <div className="shrink-0 border-border/60 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="min-w-0 truncate font-medium text-sm" title={filePath}>
            {filePath}
          </h2>
        </div>
        {textStatus && textStatus !== "present" ? (
          <div className="mt-2">
            <AssetTextStatusChip status={textStatus} />
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {assetQuery.isPending ? (
          <p className="text-muted-foreground text-sm">{messages.assets.textPreviewLoading}</p>
        ) : assetQuery.isError ? (
          <p className="text-destructive text-sm">
            {presentCoreError(
              messages,
              locale,
              assetQuery.error,
              messages.assets.textPreviewFailed,
            )}
          </p>
        ) : textStatus === "missing" ? (
          <p className="text-muted-foreground text-sm">{messages.nodeDetail.parsedTextMissing}</p>
        ) : textStatus === "none" ? (
          <p className="text-muted-foreground text-sm">{messages.nodeDetail.parsedTextNone}</p>
        ) : textStatus === "stale" ? (
          <p className="text-muted-foreground text-sm">{messages.assets.textPreviewStaleWarning}</p>
        ) : (
          <>
            {lines.length > 0 ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5">
                {lines.join("\n")}
              </pre>
            ) : null}
            {textQuery.isPending ? (
              <p className="text-muted-foreground text-sm">{messages.assets.textPreviewLoading}</p>
            ) : null}
            {textQuery.isError ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-destructive text-sm">
                  {presentCoreError(
                    messages,
                    locale,
                    textQuery.error,
                    messages.assets.textPreviewFailed,
                  )}
                </p>
                <Button
                  onClick={() => void textQuery.refetch()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <RefreshCw aria-hidden className="size-3.5" />
                  {messages.nodeDetail.filePreviewRetry}
                </Button>
              </div>
            ) : null}
            {!textQuery.isPending && !textQuery.isError && totalLines === 0 ? (
              <p className="text-muted-foreground text-sm">{messages.nodeDetail.parsedTextEmpty}</p>
            ) : null}
            {totalLines !== null && loadedThrough > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {hasMore ? (
                  <Button
                    disabled={textQuery.isFetching}
                    onClick={() =>
                      setRange({
                        startLine: loadedThrough + 1,
                        endLine: loadedThrough + TEXT_WINDOW_SIZE,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {messages.search.loadMore}
                  </Button>
                ) : null}
                <span className="text-muted-foreground text-xs">
                  {fmt(messages.assets.textPreviewRange, {
                    start: 1,
                    end: loadedThrough,
                    total: totalLines,
                  })}
                </span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
