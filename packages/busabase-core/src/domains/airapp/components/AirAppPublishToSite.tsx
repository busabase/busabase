"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AirAppSiteActionVO } from "busabase-contract/domains/airapp/contract";
import { Button } from "kui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "kui/dialog";
import { DropdownMenuItem } from "kui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "kui/tooltip";
import { ArrowUpCircle, Check, Copy, ExternalLink, Globe, Loader2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { useAgentIntegrationTarget } from "../../dashboard/agent-integration-context";
import { useWorkspacePermissionLevel } from "../../dashboard/components/split-submit-button";
import { copyAgentPromptSnapshot } from "../../dashboard/helpers/agent-prompt-clipboard";
import { renderAgentLocator, useNodeLocator } from "../../dashboard/hooks/use-copy-locator";
import { useIsAnonymousVisitor } from "../../dashboard/visitor-context";
import { AIRAPP_PREVIEW_IFRAME_SANDBOX } from "../utils/preview-sandbox";
import {
  AirAppPreviewFrame,
  AirAppPreviewTools,
  type AirAppPreviewViewport,
} from "./AirAppPreviewTools";
import { airAppSiteBlockerMessage, canGoLive } from "./AirAppSiteControls";
import { AirAppSiteReleases } from "./AirAppSiteReleases";
import {
  useAirAppEngineAvailability,
  useAirAppEnginePlanGate,
  useAirAppEnginesNotConfigured,
} from "./engine-availability-context";

interface AirAppPublishToSiteProps {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeName: string;
}

interface AirAppPublishToSiteActionsProps extends AirAppPublishToSiteProps {
  children?: (publishAction: ReactNode) => ReactNode;
  showButton?: boolean;
  compact?: boolean;
  renderButtons?: (
    publish: ReactNode,
    releases: ReactNode,
    publishMenuItem: ReactNode,
  ) => ReactNode;
}

/** A deployment alongside the running browser app: never changes its engine or files. */
export function AirAppPublishToSite({
  children,
  showButton = false,
  compact = false,
  renderButtons,
  ...props
}: AirAppPublishToSiteActionsProps) {
  const messages = useCoreI18n();
  const engines = useAirAppEngineAvailability();
  const notConfigured = useAirAppEnginesNotConfigured();
  const planGate = useAirAppEnginePlanGate();
  const isAnonymous = useIsAnonymousVisitor();
  const permission = useWorkspacePermissionLevel();
  const [open, setOpen] = useState(false);
  const offered =
    engines.includes("site") ||
    planGate?.lockedEngines.includes("site") ||
    notConfigured.includes("site");
  const canPublish = !isAnonymous && hasApiKeyLevel(permission, "write") && offered;
  const site = useQuery({
    ...props.orpc.airapps.siteState.queryOptions({ input: { nodeId: props.nodeId } }),
    enabled: canPublish && showButton,
    retry: false,
  });
  const label = site.data?.liveVersion
    ? messages.airapp.site.publishUpdate
    : messages.airapp.site.goLive;
  const publishButton =
    canPublish && showButton ? (
      <TooltipProvider delayDuration={350}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={label}
              className={
                compact
                  ? "h-8 w-8 gap-1.5 px-0 @min-[900px]/airapp-toolbar:w-auto @min-[900px]/airapp-toolbar:px-2.5"
                  : undefined
              }
              data-airapp-publish-to-site=""
              disabled={site.isPending}
              onClick={() => setOpen(true)}
              size="sm"
              type="button"
            >
              {site.isPending ? (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              ) : (
                <Globe
                  aria-hidden="true"
                  className={compact ? "size-3.5" : "hidden size-3.5 sm:block"}
                />
              )}
              <span className={compact ? "hidden @min-[900px]/airapp-toolbar:inline" : undefined}>
                {label}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent className="text-xs">{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : null;
  const releasesButton =
    canPublish && showButton ? <AirAppSiteReleases compact={compact} {...props} /> : null;

  const publishMenuItem = canPublish ? (
    <DropdownMenuItem data-airapp-publish-to-site="" onSelect={() => setOpen(true)}>
      <Globe aria-hidden="true" className="mr-2 size-3.5" />
      {label}
    </DropdownMenuItem>
  ) : null;

  return (
    <>
      {renderButtons ? (
        renderButtons(publishButton, releasesButton, publishMenuItem)
      ) : (
        <>
          {publishButton}
          {releasesButton}
        </>
      )}
      {children?.(publishMenuItem)}
      {/* Menu content unmounts on selection; keep the publishing flow outside it. */}
      {canPublish && open ? <PublishDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PublishDialog({
  orpc,
  nodeId,
  nodeName,
  onClose,
}: AirAppPublishToSiteProps & {
  onClose: () => void;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const integration = useAgentIntegrationTarget();
  const copy = messages.airapp.site.publish;
  const planGate = useAirAppEnginePlanGate();
  const client = useQueryClient();
  const options = orpc.airapps.siteState.queryOptions({ input: { nodeId } });
  // A newly opened dialog always checks the plan and the saved app files again.
  const query = useQuery({ ...options, staleTime: 0, refetchOnMount: "always", retry: false });
  const state = query.data;
  const [error, setError] = useState<string | null>(null);
  const [preparedVersion, setPreparedVersion] = useState<string | null>(null);
  const [preparedUrl, setPreparedUrl] = useState<string | null>(null);
  const [reviewedVersion, setReviewedVersion] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewport, setViewport] = useState<AirAppPreviewViewport>("desktop");
  const locator = useNodeLocator({ nodeId, nodeName, nodeType: "airapp" });
  const actionResult = ({ outcome, state: next }: AirAppSiteActionVO) => {
    client.setQueryData(options.queryKey, next);
    setError(
      outcome === "preview-stale"
        ? copy.previewStale
        : outcome === "no-preview"
          ? copy.noPreview
          : null,
    );
  };
  const preview = useMutation({
    mutationFn: () => orpc.airapps.siteDeployPreview.call({ nodeId }),
    onMutate: () => {
      setError(null);
      setPreparedVersion(null);
      setReviewedVersion(null);
    },
    onSuccess: (result) => {
      actionResult(result);
      if (result.outcome === "ok") {
        setPreparedVersion(result.state.previewVersion);
        setPreparedUrl(
          result.state.previewUrl && result.state.previewVersion
            ? `${result.state.previewUrl}?__busabase_site_version=${encodeURIComponent(result.state.previewVersion)}`
            : null,
        );
      }
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      void query.refetch();
    },
  });
  const publish = useMutation({
    mutationFn: () => orpc.airapps.siteGoLive.call({ nodeId }),
    onMutate: () => setError(null),
    onSuccess: (result) => {
      actionResult(result);
      if (result.outcome === "ok") {
        void client.invalidateQueries({
          queryKey: orpc.airapps.siteReleases.queryOptions({ input: { nodeId } }).queryKey,
        });
      }
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      void query.refetch();
    },
  });
  const busy = preview.isPending || publish.isPending;
  const locked = state?.engine === "locked";
  const configured = state?.engine === "available" || locked;
  const blockers = state?.blockers ?? [];
  const previewVersion = state?.previewVersion;
  const previewUrl =
    state?.previewUrl && previewVersion && preparedVersion === previewVersion
      ? `${state.previewUrl}?__busabase_site_version=${encodeURIComponent(previewVersion)}`
      : null;
  // Keep the address bar and its refresh control in place while a new private
  // preview is prepared. Publication still waits for the new iframe to load.
  const toolbarPreviewUrl = previewUrl ?? (preview.isPending ? preparedUrl : null);
  const canPublish =
    state &&
    !query.isError &&
    !query.isFetching &&
    blockers.length === 0 &&
    canGoLive(state) &&
    reviewedVersion === previewVersion;

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open
    >
      <DialogContent className="max-h-[90dvh] grid-cols-1 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe aria-hidden="true" className="size-4 text-primary" />
            {state?.liveVersion ? messages.airapp.site.publishUpdate : messages.airapp.site.goLive}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{copy.preserveBrowser}</p>
        {query.isPending ? <p role="status">{copy.checking}</p> : null}
        {query.isError ? (
          <div className="space-y-2" role="alert">
            <p className="text-destructive text-sm">
              {query.error instanceof Error ? query.error.message : copy.checkFailed}
            </p>
            <Button onClick={() => void query.refetch()} size="sm" variant="outline">
              {messages.common.retry}
            </Button>
          </div>
        ) : null}
        {state && !query.isError ? (
          <>
            {!configured ? (
              <p className="text-muted-foreground text-sm" role="status">
                {messages.airapp.engineNotConfigured}
              </p>
            ) : null}
            {locked ? (
              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                <p className="font-medium text-sm">
                  {planGate
                    ? fmt(copy.planRequired, { plan: planGate.planLabel })
                    : copy.paidPlanRequired}
                </p>
                <p className="text-muted-foreground text-sm">{copy.upgradeHint}</p>
                {planGate?.onUpgrade ? (
                  <Button
                    className="gap-1.5"
                    onClick={() => {
                      onClose();
                      planGate.onUpgrade?.();
                    }}
                    size="sm"
                    type="button"
                  >
                    <ArrowUpCircle aria-hidden="true" className="size-3.5" />
                    {fmt(messages.airapp.enginePlan.upgrade, { plan: planGate.planLabel })}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {configured && blockers.length > 0 ? (
              <div className="space-y-3 rounded-md border border-border p-3">
                <p className="font-medium text-sm">{copy.prepareTitle}</p>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground text-sm">
                  {blockers.map((blocker) => (
                    <li key={JSON.stringify(blocker)}>
                      {airAppSiteBlockerMessage(messages, blocker)}
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground text-sm">{copy.prepareHint}</p>
                <Button
                  className="gap-1.5"
                  onClick={async () => {
                    setError(null);
                    try {
                      await copyAgentPromptSnapshot({
                        text: renderAgentLocator(
                          { messages, locale, integration },
                          locator,
                          copy.agentPrompt,
                        ),
                      });
                      setCopied(true);
                    } catch {
                      setError(messages.agentPrompts.locatorCopyFailed);
                    }
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? copy.copied : copy.copyPrompt}
                </Button>
              </div>
            ) : null}
            {state.publication !== "not-live" && state.address ? (
              <div className="space-y-1 rounded-md border border-border p-3">
                <p className="font-medium text-sm">
                  {state.publication === "live"
                    ? messages.airapp.site.statusLive
                    : messages.airapp.site.statusLiveWithChanges}
                </p>
                <a
                  className="inline-flex max-w-full items-center gap-1 break-all text-primary text-sm underline-offset-2 hover:underline"
                  href={state.address}
                  rel="noreferrer"
                  target="_blank"
                >
                  {state.address}
                  <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                </a>
              </div>
            ) : null}
            {state.engine === "available" && blockers.length === 0 ? (
              <div className="space-y-3">
                <p className="text-muted-foreground text-sm">{copy.previewHint}</p>
                {!toolbarPreviewUrl || state.previewStale ? (
                  <Button
                    className="gap-1.5"
                    disabled={busy || query.isFetching}
                    onClick={() => preview.mutate()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {preview.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    {preview.isPending ? copy.preparingPreview : copy.createPreview}
                  </Button>
                ) : null}
                {state.previewStale && error !== copy.previewStale ? (
                  <p className="text-muted-foreground text-sm" role="status">
                    {copy.previewStale}
                  </p>
                ) : null}
                {toolbarPreviewUrl && !state.previewStale ? (
                  <div className="space-y-2">
                    <AirAppPreviewTools
                      kind="site"
                      onRefresh={() => preview.mutate()}
                      refreshDisabled={busy || query.isFetching}
                      refreshLabel={copy.refreshPreview}
                      refreshing={preview.isPending}
                      setViewport={setViewport}
                      url={toolbarPreviewUrl}
                      viewport={viewport}
                    />
                    {previewUrl ? (
                      <AirAppPreviewFrame className="h-80" viewport={viewport}>
                        <iframe
                          className="h-full w-full border-0 bg-background"
                          key={previewUrl}
                          onLoad={async () => {
                            try {
                              let response = await fetch(previewUrl, {
                                method: "HEAD",
                                credentials: "same-origin",
                                cache: "no-store",
                                signal: AbortSignal.timeout(15_000),
                              });
                              // A valid Worker may serve pages without implementing HEAD.
                              if (response.status === 405 || response.status === 501) {
                                response = await fetch(previewUrl, {
                                  credentials: "same-origin",
                                  cache: "no-store",
                                  signal: AbortSignal.timeout(15_000),
                                });
                              }
                              if (!response.ok) throw new Error(copy.previewUnavailable);
                              setReviewedVersion(previewVersion ?? null);
                            } catch {
                              setError(copy.previewUnavailable);
                              setReviewedVersion(null);
                            }
                          }}
                          sandbox={AIRAPP_PREVIEW_IFRAME_SANDBOX}
                          src={previewUrl}
                          title={copy.previewTitle}
                        />
                      </AirAppPreviewFrame>
                    ) : (
                      <div
                        className="grid h-80 place-items-center text-muted-foreground text-sm"
                        role="status"
                      >
                        {copy.preparingPreview}
                      </div>
                    )}
                  </div>
                ) : null}
                {previewUrl && !state.previewStale ? (
                  <p className="text-muted-foreground text-sm">{copy.publishConsent}</p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            {messages.common.close}
          </Button>
          {state?.engine === "available" && blockers.length === 0 && !query.isError ? (
            <Button disabled={!canPublish || busy} onClick={() => publish.mutate()} type="button">
              {publish.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {state?.liveVersion
                ? messages.airapp.site.publishUpdate
                : messages.airapp.site.goLive}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
