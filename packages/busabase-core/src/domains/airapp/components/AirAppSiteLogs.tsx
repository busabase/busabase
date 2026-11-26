"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Button } from "kui/button";
import { Loader2, RefreshCw, Shield, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { readSiteAccessDenial, siteAccessMessage } from "../utils/site-access";

interface AirAppSiteLogsProps {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  version: string;
  versionLabel: string;
  id: string;
  onClose: () => void;
}

/** Mounted only while visible, so the RPC's consumed AbortSignal cancels on close or release switch. */
export function AirAppSiteLogs({
  orpc,
  nodeId,
  version,
  versionLabel,
  id,
  onClose,
}: AirAppSiteLogsProps) {
  const messages = useCoreI18n();
  const copy = messages.airapp.site.logs;
  const locale = useCoreLocale();
  const panel = useRef<HTMLElement>(null);
  const logs = useQuery({
    ...orpc.airapps.siteLogs.queryOptions({ input: { nodeId, version } }),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const data = logs.data?.version === version ? logs.data : undefined;
  const failed = logs.isError || (logs.data !== undefined && data === undefined);
  const permissionDenied = readSiteAccessDenial(logs.error);
  const hasEntryHiddenReason =
    data?.entries.some(
      (entry) => entry.contentHiddenReason === "VAULT_REDACTION_CONTEXT_UNAVAILABLE",
    ) ?? false;
  const contentHidden =
    data?.contentHiddenReason === "VAULT_REDACTION_CONTEXT_UNAVAILABLE" || hasEntryHiddenReason;
  const stamp = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(new Date(value));

  useEffect(() => {
    panel.current?.scrollIntoView?.({ block: "nearest" });
    panel.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="min-w-0 space-y-3 rounded-md border border-border bg-muted/20 p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-airapp-site-logs={version}
      id={id}
      ref={panel}
      tabIndex={-1}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-sm" id={`${id}-title`}>
          {fmt(copy.title, { version: versionLabel })}
        </h3>
        <div className="flex items-center gap-1">
          {!permissionDenied ? (
            <Button
              disabled={logs.isFetching}
              onClick={() => void logs.refetch()}
              size="sm"
              variant="outline"
            >
              {logs.isFetching ? (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw aria-hidden="true" className="size-3.5" />
              )}
              {copy.refresh}
            </Button>
          ) : null}
          <Button aria-label={copy.close} onClick={onClose} size="icon-sm" variant="ghost">
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">{copy.description}</p>
      <p className="text-muted-foreground text-xs">{copy.collectionHint}</p>
      {logs.isPending ? (
        <p className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          {copy.loading}
        </p>
      ) : failed ? (
        <div className="space-y-2">
          <p className="text-destructive text-sm" role="alert">
            {permissionDenied
              ? siteAccessMessage(messages.airapp.site.environment, permissionDenied)
              : copy.loadFailed}
          </p>
          {!permissionDenied ? (
            <Button
              disabled={logs.isFetching}
              onClick={() => void logs.refetch()}
              size="sm"
              variant="outline"
            >
              {messages.common.retry}
            </Button>
          ) : null}
        </div>
      ) : !data?.available ? (
        <p className="text-muted-foreground text-sm" role="status">
          {copy.unavailable}
        </p>
      ) : (
        <>
          {contentHidden ? (
            <div
              className="space-y-1 rounded-md border border-border bg-muted/50 p-3 text-muted-foreground text-xs"
              data-airapp-site-logs-content-hidden=""
              role="status"
            >
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                <Shield aria-hidden="true" className="size-3.5 shrink-0" />
                {copy.contentHiddenTitle}
              </p>
              <p>{copy.contentHiddenDescription}</p>
            </div>
          ) : null}
          <p className="text-muted-foreground text-xs">
            {fmt(copy.checkedAt, { time: stamp(data.to) })}
          </p>
          {data.entries.length ? (
            <div
              aria-label={copy.button}
              className="max-h-80 min-w-0 overflow-y-auto overscroll-contain rounded-sm border border-border bg-background p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              role="region"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: A focusable scroll viewport lets keyboard users read long log output.
              tabIndex={0}
            >
              <ol aria-label={fmt(copy.title, { version: versionLabel })} className="space-y-2">
                {data.entries.map((entry) => {
                  const entryContentHidden =
                    entry.contentHiddenReason === "VAULT_REDACTION_CONTEXT_UNAVAILABLE" ||
                    (contentHidden && !hasEntryHiddenReason);
                  return (
                    <li
                      className="min-w-0 space-y-1 border-border border-b pb-2 last:border-0 last:pb-0"
                      key={entry.id}
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                        <time dateTime={entry.timestamp}>{stamp(entry.timestamp)}</time>
                        <span
                          className={
                            entry.level === "error" ? "font-medium text-destructive" : "font-medium"
                          }
                        >
                          {copy.levels[entry.level]}
                        </span>
                      </div>
                      {entry.method ||
                      (!entryContentHidden && entry.path) ||
                      entry.status !== null ? (
                        <p className="break-words font-mono [overflow-wrap:anywhere]">
                          {[entry.method, ...(entryContentHidden ? [] : [entry.path]), entry.status]
                            .filter((value) => value !== null)
                            .join(" ")}
                        </p>
                      ) : null}
                      {!entryContentHidden ? (
                        <p className="whitespace-pre-wrap break-words font-mono [overflow-wrap:anywhere]">
                          {entry.message}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm" role="status">
              {copy.empty}
            </p>
          )}
          {data.truncated ? (
            <p className="text-muted-foreground text-xs" role="status">
              {copy.truncated}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
