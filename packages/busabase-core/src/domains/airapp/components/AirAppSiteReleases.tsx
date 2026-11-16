"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Button } from "kui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "kui/tooltip";
import { Check, Copy, History, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { ShareLinkActions } from "../../dashboard/components/share-link-actions";
import type { SidePanelTabProps } from "../../dashboard/side-panel-registry";
import { useSidePanelStore } from "../../dashboard/store/side-panel-store";
import {
  AIRAPP_SITE_RELEASES_TAB_TYPE,
  AirAppSiteReleasesPayloadSchema,
  airAppSiteReleasesTabId,
} from "../utils/site-release-panel";
import { AirAppSiteSettings } from "./AirAppSiteControls";

interface AirAppSiteReleasesProps {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeName: string;
  compact?: boolean;
}

/** Production recovery stays beside publication, separate from the working preview. */
export function AirAppSiteReleases(props: AirAppSiteReleasesProps) {
  const messages = useCoreI18n();
  const client = useQueryClient();
  const tabId = airAppSiteReleasesTabId(props.nodeId);
  const active = useSidePanelStore((state) => state.isOpen && state.activeTabId === tabId);
  return (
    <TooltipProvider delayDuration={350}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={messages.airapp.site.releases.manage}
            aria-pressed={active}
            data-airapp-release-management=""
            className={
              props.compact
                ? "h-8 w-8 gap-1.5 px-0 @min-[900px]/airapp-toolbar:w-auto @min-[900px]/airapp-toolbar:px-2.5"
                : undefined
            }
            onClick={() => {
              const input = { nodeId: props.nodeId };
              void Promise.all([
                client.invalidateQueries({
                  queryKey: props.orpc.airapps.siteState.queryOptions({ input }).queryKey,
                }),
                client.invalidateQueries({
                  queryKey: props.orpc.airapps.siteReleases.queryOptions({ input }).queryKey,
                }),
              ]);
              const payload = { nodeId: props.nodeId, nodeName: props.nodeName };
              const panel = useSidePanelStore.getState();
              panel.updateTabPayload(tabId, payload);
              panel.openTab({
                id: tabId,
                type: AIRAPP_SITE_RELEASES_TAB_TYPE,
                title: `${props.nodeName} · ${messages.airapp.site.releases.manage}`,
                payload,
              });
            }}
            size="sm"
            title={props.compact ? undefined : messages.airapp.site.releases.manage}
            type="button"
            variant="outline"
          >
            <History aria-hidden="true" className="size-3.5" />
            <span
              className={
                props.compact ? "hidden @min-[900px]/airapp-toolbar:inline" : "hidden sm:inline"
              }
            >
              {messages.airapp.site.releases.manage}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent className="text-xs">{messages.airapp.site.releases.manage}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Shares the workspace panel's tab, resize, maximize and mobile controls. */
export function AirAppSiteReleasesPanel({ orpc, payload }: SidePanelTabProps) {
  const parsed = AirAppSiteReleasesPayloadSchema.safeParse(payload);
  return parsed.success ? <ReleaseContents orpc={orpc} {...parsed.data} /> : null;
}

function ReleaseContents({ orpc, nodeId, nodeName }: AirAppSiteReleasesProps) {
  const messages = useCoreI18n();
  const copy = messages.airapp.site.releases;
  const locale = useCoreLocale();
  const client = useQueryClient();
  const id = useId();
  const confirmationRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useSidePanelStore(
    (state) => state.isOpen && state.activeTabId === airAppSiteReleasesTabId(nodeId),
  );
  const siteOptions = orpc.airapps.siteState.queryOptions({ input: { nodeId } });
  const releaseOptions = orpc.airapps.siteReleases.queryOptions({ input: { nodeId } });
  const site = useQuery({
    ...siteOptions,
    enabled: active,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  const releases = useQuery({
    ...releaseOptions,
    enabled: active,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
    refetchInterval: (query) =>
      active && query.state.data?.status === "deploying" ? 2_000 : false,
  });
  const data = releases.data;
  const versions = [...(data?.versions ?? [])].sort(
    (a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.releaseNumber - a.releaseNumber,
  );
  const address = site.data?.address ?? null;
  const rollback = useMutation({
    mutationFn: (version: string) => orpc.airapps.siteRollback.call({ nodeId, version }),
    onMutate: () => setError(null),
    onSuccess: async (result) => {
      client.setQueryData(siteOptions.queryKey, result.state);
      setTarget(null);
      await releases.refetch();
      toast.success(copy.rollbackDone);
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      void Promise.all([site.refetch(), releases.refetch()]);
    },
  });
  const busy = rollback.isPending || data?.status === "deploying";
  const canRollback = site.data?.engine === "available" && Boolean(data?.available);
  const checking = site.isFetching || releases.isFetching || !active;
  const stamp = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );
  const name = (version: string, releaseNumber?: number) =>
    releaseNumber ? `v${releaseNumber}` : version.slice(0, 10);
  const selected = data?.versions.find(
    (version) => version.version === target && version.canRollback,
  );
  useEffect(() => {
    if (!target) return;
    confirmationRef.current?.scrollIntoView?.({ block: "nearest" });
    confirmationRef.current?.focus({ preventScroll: true });
  }, [target]);

  if (site.isPending || releases.isPending) {
    return (
      <div aria-label={copy.loading} className="space-y-5 p-6" role="status">
        <div className="h-20 animate-pulse rounded-md bg-muted" />
        <div className="h-32 animate-pulse rounded-md bg-muted" />
        <span className="sr-only">{copy.loading}</span>
      </div>
    );
  }
  if (site.isError || releases.isError) {
    return (
      <div className="space-y-3 p-6" role="alert">
        <p className="text-destructive text-sm">{copy.loadFailed}</p>
        <Button
          onClick={() => void Promise.all([site.refetch(), releases.refetch()])}
          size="sm"
          variant="outline"
        >
          {messages.common.retry}
        </Button>
      </div>
    );
  }

  return (
    <div
      className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5"
      data-airapp-release-panel=""
    >
      <section aria-label={messages.airapp.site.addressLabel} className="space-y-3">
        <AirAppSiteSettings enabled={active} nodeId={nodeId} orpc={orpc} />
        {address ? (
          <div className="space-y-2">
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(address);
                  setCopied(true);
                  setCopyFailed(false);
                } catch {
                  setCopyFailed(true);
                }
              }}
              size="sm"
              variant="outline"
            >
              {copied ? (
                <Check aria-hidden="true" className="size-3.5" />
              ) : (
                <Copy aria-hidden="true" className="size-3.5" />
              )}
              {copied ? copy.copied : copy.copyAddress}
            </Button>
            {copyFailed ? (
              <p className="text-destructive text-xs" role="alert">
                {copy.copyFailed}
              </p>
            ) : null}
            {site.data?.isPublic ? (
              <>
                <p className="text-muted-foreground text-xs">{copy.publicQrHint}</p>
                <ShareLinkActions title={nodeName} url={address} />
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-3" aria-labelledby={`${id}-versions`}>
        <div className="space-y-1">
          <h3 className="font-medium text-sm" id={`${id}-versions`}>
            {copy.versions}
          </h3>
          <p className="text-muted-foreground text-xs">{copy.retention}</p>
        </div>
        {!data?.available ? (
          <p className="text-muted-foreground text-sm">{copy.unavailable}</p>
        ) : null}
        {versions.length ? (
          <ul className="divide-y divide-border border-border border-y">
            {versions.map((version) => (
              <li
                className="flex items-center justify-between gap-3 py-3"
                data-airapp-release-version={version.version}
                key={version.version}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">
                      {name(version.version, version.releaseNumber)}
                    </span>
                    {version.isCurrent ? (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary text-xs">
                        {copy.current}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    <time dateTime={version.createdAt}>{stamp(version.createdAt)}</time>
                  </p>
                  {version.releaseNumber === 0 ? (
                    <p className="text-muted-foreground text-xs">{copy.legacy}</p>
                  ) : (
                    <p className="font-mono text-muted-foreground text-xs" title={version.version}>
                      {version.version.slice(0, 10)}
                    </p>
                  )}
                </div>
                {version.canRollback ? (
                  <Button
                    aria-label={fmt(copy.rollbackVersion, {
                      version: name(version.version, version.releaseNumber),
                    })}
                    disabled={busy || !canRollback || checking}
                    onClick={() => {
                      setTarget(version.version);
                      setError(null);
                    }}
                    size="sm"
                    variant="outline"
                  >
                    <RotateCcw aria-hidden="true" className="size-3.5" />
                    {copy.rollback}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{copy.empty}</p>
        )}
        {site.data?.engine === "locked" ? (
          <p className="text-muted-foreground text-xs">{copy.planLocked}</p>
        ) : null}
        {data?.status === "deploying" ? (
          <p className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            {copy.busy}
          </p>
        ) : null}
        {selected ? (
          <div
            aria-label={fmt(copy.confirmTitle, {
              version: name(selected.version, selected.releaseNumber),
            })}
            className="space-y-3 rounded-md border border-border bg-muted/30 p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-airapp-rollback-confirm=""
            ref={confirmationRef}
            role="group"
            tabIndex={-1}
          >
            <p className="font-medium text-sm">
              {fmt(copy.confirmTitle, { version: name(selected.version, selected.releaseNumber) })}
            </p>
            <p className="text-muted-foreground text-sm">{copy.confirmBody}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                disabled={rollback.isPending}
                onClick={() => setTarget(null)}
                size="sm"
                variant="outline"
              >
                {messages.common.cancel}
              </Button>
              <Button
                disabled={busy || !canRollback || checking}
                onClick={() => rollback.mutate(selected.version)}
                size="sm"
              >
                {rollback.isPending ? (
                  <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                ) : null}
                {copy.confirm}
              </Button>
            </div>
          </div>
        ) : null}
        {error || data?.lastError ? (
          <p className="text-destructive text-sm" role="alert">
            {error ?? data?.lastError}
          </p>
        ) : null}
      </section>

      <section aria-labelledby={`${id}-history`} className="space-y-3">
        <h3 className="font-medium text-sm" id={`${id}-history`}>
          {copy.history}
        </h3>
        {data?.history.length ? (
          <ol className="space-y-3">
            {data.history.map((entry) => (
              <li className="flex items-start gap-2 text-sm" key={entry.id}>
                <History
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                />
                <div className="space-y-1">
                  <p>
                    {entry.kind === "rollback" ? copy.actionRollback : copy.actionPublish}{" "}
                    <span className="font-mono text-xs">
                      {name(entry.version, entry.releaseNumber)}
                    </span>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    <time dateTime={entry.createdAt}>{stamp(entry.createdAt)}</time>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground text-sm">{copy.historyEmpty}</p>
        )}
      </section>
    </div>
  );
}
