"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Button } from "kui/button";
import { Check, Copy, History, Loader2, Logs, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { ShareLinkActions } from "../../dashboard/components/share-link-actions";
import {
  readSiteAccessDenial,
  type SiteAccessDenial,
  siteAccessMessage,
  siteDeploymentDenial,
} from "../utils/site-access";
import { AirAppPublishToSite } from "./AirAppPublishToSite";
import { AirAppSiteSettings } from "./AirAppSiteControls";
import { AirAppSiteLogs } from "./AirAppSiteLogs";

interface AirAppSiteReleasesProps {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeName: string;
}

/** Website configuration and release history inside the AirApp's node settings. */
export function AirAppSiteReleaseSettings({
  orpc,
  nodeId,
  nodeName,
  active,
  initialSettingsOpen = false,
}: AirAppSiteReleasesProps & { active: boolean; initialSettingsOpen?: boolean }) {
  const messages = useCoreI18n();
  const copy = messages.airapp.site.releases;
  const locale = useCoreLocale();
  const client = useQueryClient();
  const id = useId();
  const confirmationRef = useRef<HTMLDivElement>(null);
  const logsTriggerRef = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [logsVersion, setLogsVersion] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState<SiteAccessDenial | null>(null);
  const settingsRef = useRef<HTMLDetailsElement>(null);
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
  useEffect(() => {
    if (
      !active ||
      !initialSettingsOpen ||
      site.isPending ||
      releases.isPending ||
      !settingsRef.current
    )
      return;
    settingsRef.current.open = true;
    settingsRef.current.scrollIntoView?.({ block: "nearest" });
  }, [active, initialSettingsOpen, site.isPending, releases.isPending]);
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
      const denial = readSiteAccessDenial(cause);
      setAccessDenied(denial);
      setError(denial ? null : cause instanceof Error ? cause.message : String(cause));
      if (!denial) void Promise.all([site.refetch(), releases.refetch()]);
    },
  });
  const denial =
    accessDenied ??
    readSiteAccessDenial(site.error) ??
    readSiteAccessDenial(releases.error) ??
    siteDeploymentDenial(site.data);
  const permissionMessage = denial
    ? siteAccessMessage(messages.airapp.site.environment, denial)
    : null;
  const busy = rollback.isPending || data?.status === "deploying";
  const canRollback =
    site.data?.engine === "available" &&
    !site.data.publicationLock &&
    !denial &&
    Boolean(data?.available);
  const checking = site.isFetching || releases.isFetching || !active;
  const stamp = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );
  const name = (version: string, releaseNumber?: number) =>
    releaseNumber ? `v${releaseNumber}` : version.slice(0, 10);
  const logsId = (version: string) => `${id}-logs-${encodeURIComponent(version)}`;
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
        <p className="text-destructive text-sm">{permissionMessage ?? copy.loadFailed}</p>
        {!denial ? (
          <Button
            onClick={() => void Promise.all([site.refetch(), releases.refetch()])}
            size="sm"
            variant="outline"
          >
            {messages.common.retry}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6" data-airapp-release-panel="">
      <section
        aria-label={messages.airapp.site.addressLabel}
        className="space-y-3 border-border border-b bg-background py-2"
        data-airapp-release-summary=""
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-sm">
              {site.data?.publication === "live"
                ? messages.airapp.site.statusLive
                : site.data?.publication === "live-with-changes"
                  ? messages.airapp.site.statusLiveWithChanges
                  : messages.airapp.site.statusNotLive}
            </p>
            {address ? (
              <a
                aria-label={address}
                className="block truncate text-muted-foreground text-sm underline-offset-2 hover:text-foreground hover:underline"
                href={address}
                rel="noreferrer"
                target="_blank"
                title={address}
              >
                {address}
              </a>
            ) : null}
          </div>
          <AirAppPublishToSite
            compact
            nodeId={nodeId}
            nodeName={nodeName}
            orpc={orpc}
            showButton={active}
          />
        </div>
        {address ? (
          <div className="flex items-center gap-1">
            <Button
              aria-label={copied ? copy.copied : copy.copyAddress}
              title={copied ? copy.copied : copy.copyAddress}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(address);
                  setCopied(true);
                  setCopyFailed(false);
                } catch {
                  setCopyFailed(true);
                }
              }}
              size="icon-sm"
              variant="ghost"
            >
              {copied ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <Copy aria-hidden="true" className="size-4" />
              )}
            </Button>
            {site.data?.isPublic ? (
              <ShareLinkActions
                compact
                description={copy.publicQrHint}
                title={nodeName}
                url={address}
              />
            ) : null}
          </div>
        ) : null}
        {copyFailed && address ? (
          <div className="space-y-1">
            <p className="text-destructive text-xs" role="alert">
              {copy.copyFailed}
            </p>
            <input
              aria-label={copy.copyAddress}
              className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              value={address}
            />
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
                className="min-w-0 space-y-3 py-2"
                data-airapp-release-version={version.version}
                key={version.version}
              >
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
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
                    <p
                      className="truncate text-muted-foreground text-xs"
                      title={`${stamp(version.createdAt)} · ${version.version}`}
                    >
                      <time dateTime={version.createdAt}>{stamp(version.createdAt)}</time>
                    </p>
                    {version.releaseNumber === 0 ? (
                      <p className="text-muted-foreground text-xs">{copy.legacy}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    <Button
                      aria-controls={
                        logsVersion === version.version && active
                          ? logsId(version.version)
                          : undefined
                      }
                      aria-expanded={logsVersion === version.version && active}
                      aria-label={fmt(messages.airapp.site.logs.versionButton, {
                        version: name(version.version, version.releaseNumber),
                      })}
                      onClick={(event) => {
                        logsTriggerRef.current = event.currentTarget;
                        setLogsVersion(version.version);
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      <Logs aria-hidden="true" className="size-3.5" />
                      {messages.airapp.site.logs.button}
                    </Button>
                    {version.canRollback || (Boolean(denial) && !version.isCurrent) ? (
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
                  </div>
                </div>
                {active && logsVersion === version.version ? (
                  <AirAppSiteLogs
                    id={logsId(version.version)}
                    key={`${nodeId}:${version.version}`}
                    nodeId={nodeId}
                    onClose={() => {
                      setLogsVersion(null);
                      logsTriggerRef.current?.focus();
                    }}
                    orpc={orpc}
                    version={version.version}
                    versionLabel={name(version.version, version.releaseNumber)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{copy.empty}</p>
        )}
        {permissionMessage ? (
          <p
            className="text-muted-foreground text-sm"
            data-airapp-site-access-denied=""
            role="alert"
          >
            {permissionMessage}
          </p>
        ) : null}
        {site.data?.engine === "locked" || site.data?.publicationLock ? (
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

      <details className="border-border border-t pt-4" data-airapp-release-history="">
        <summary className="cursor-pointer text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <h3 className="inline font-medium" id={`${id}-history`}>
            {copy.history}
          </h3>
          {data?.history.length ? (
            <span className="ml-2 text-muted-foreground text-xs tabular-nums">
              {data.history.length}
            </span>
          ) : null}
        </summary>
        {data?.history.length ? (
          <ol className="mt-4 space-y-3">
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
      </details>
      <details
        className="border-border border-t pt-4"
        data-airapp-release-settings=""
        ref={settingsRef}
      >
        <summary className="cursor-pointer font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {messages.nodeSettings.dialogTitle}
        </summary>
        <div className="mt-3">
          <AirAppSiteSettings enabled={active} nodeId={nodeId} orpc={orpc} />
        </div>
      </details>
    </div>
  );
}
