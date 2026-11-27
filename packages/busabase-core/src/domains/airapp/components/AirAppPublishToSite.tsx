"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AirAppSiteActionVO,
  AirAppSiteEnvironmentVO,
} from "busabase-contract/domains/airapp/contract";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "kui/alert-dialog";
import { Button } from "kui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "kui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "kui/tooltip";
import { ArrowUpCircle, Check, ChevronDown, Copy, Globe, GlobeLock, Loader2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { airAppToolbarMessages } from "../../../i18n/airapp-toolbar";
import { useAgentIntegrationTarget } from "../../dashboard/agent-integration-context";
import { useWorkspacePermissionLevel } from "../../dashboard/components/split-submit-button";
import { copyAgentPromptSnapshot } from "../../dashboard/helpers/agent-prompt-clipboard";
import { renderAgentLocator, useNodeLocator } from "../../dashboard/hooks/use-copy-locator";
import { useIsAnonymousVisitor } from "../../dashboard/visitor-context";
import {
  readSiteAccessDenial,
  type SiteAccessDenial,
  siteAccessMessage,
  siteDeploymentDenial,
} from "../utils/site-access";
import {
  AirAppPreviewFrame,
  AirAppPreviewTools,
  type AirAppPreviewViewport as AirAppViewportSize,
} from "./AirAppPreviewTools";
import { AirAppPreviewViewport } from "./AirAppPreviewViewport";
import { AirAppSiteConfigurationList } from "./AirAppSiteConfigurationList";
import { airAppSiteBlockerMessage, canGoLive } from "./AirAppSiteControls";
import {
  useAirAppEngineAvailability,
  useAirAppEnginePlanGate,
  useAirAppEnginesNotConfigured,
} from "./engine-availability-context";

interface AirAppPublishToSiteProps {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeName: string;
  /** Saved source files changed; refresh the preview/publication comparison. */
  filesRevision?: string;
}

interface AirAppPublishToSiteActionsProps extends AirAppPublishToSiteProps {
  children?: (publishAction: ReactNode) => ReactNode;
  showButton?: boolean;
  /** Toolbar buttons are prominent only when there is a version to publish. */
  buttonWhenNeeded?: boolean;
  /** A Site runner is already preparing this app; avoid concurrent publication actions. */
  publicationBusy?: boolean;
  placement?: "toolbar" | "menu";
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
  buttonWhenNeeded = false,
  publicationBusy = false,
  placement = "toolbar",
  compact = false,
  renderButtons,
  ...props
}: AirAppPublishToSiteActionsProps) {
  const messages = useCoreI18n();
  const toolbarCopy = airAppToolbarMessages[useCoreLocale()];
  const client = useQueryClient();
  const engines = useAirAppEngineAvailability();
  const notConfigured = useAirAppEnginesNotConfigured();
  const planGate = useAirAppEnginePlanGate();
  const isAnonymous = useIsAnonymousVisitor();
  const permission = useWorkspacePermissionLevel();
  const [open, setOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const unpublishReturnFocus = useRef<HTMLElement | null>(null);
  const publishTrigger = useRef<HTMLButtonElement | null>(null);
  const rememberMenuTrigger = (target: HTMLElement | null) => {
    let menu = target?.closest('[role="menu"]');
    while (menu) {
      const triggerId = menu.getAttribute("aria-labelledby");
      const trigger = triggerId ? document.getElementById(triggerId) : null;
      if (!trigger) break;
      const parentMenu = trigger.closest('[role="menu"]');
      if (!parentMenu || parentMenu === menu) {
        unpublishReturnFocus.current = trigger;
        return;
      }
      menu = parentMenu;
    }
  };
  const restorePublicationFocus = (event: Event) => {
    const target = unpublishReturnFocus.current?.isConnected
      ? unpublishReturnFocus.current
      : publishTrigger.current;
    if (target?.isConnected) {
      event.preventDefault();
      target.focus();
    }
  };
  const offered =
    engines.includes("site") ||
    planGate?.lockedEngines.includes("site") ||
    notConfigured.includes("site");
  const canPublish = !isAnonymous && hasApiKeyLevel(permission, "write") && offered;
  const site = useQuery({
    ...props.orpc.airapps.siteState.queryOptions({ input: { nodeId: props.nodeId } }),
    enabled: canPublish && (showButton || placement === "menu"),
    retry: false,
  });
  const hasPublicSite = Boolean(site.data?.isPublic && site.data.liveVersion);
  const label = hasPublicSite
    ? site.data?.publication === "live-with-changes"
      ? toolbarCopy.publishUpdate
      : toolbarCopy.published
    : toolbarCopy.publish;
  const needsPublication =
    site.data?.engine === "available" &&
    !site.data.publicationLock &&
    !site.data.environmentDeploymentLock &&
    site.data.blockers.length === 0 &&
    site.data.publication !== "live";
  const unpublish = useMutation({
    mutationFn: () => props.orpc.airapps.siteUnpublish.call({ nodeId: props.nodeId }),
    onSuccess: async ({ outcome, state }: AirAppSiteActionVO) => {
      if (outcome !== "ok") {
        toast.error(messages.airapp.runFailed);
        return;
      }
      client.setQueryData(
        props.orpc.airapps.siteState.queryOptions({ input: { nodeId: props.nodeId } }).queryKey,
        state,
      );
      await Promise.all([
        client.invalidateQueries({
          queryKey: props.orpc.airapps.siteState.queryOptions({ input: { nodeId: props.nodeId } })
            .queryKey,
        }),
        client.invalidateQueries({
          queryKey: props.orpc.airapps.siteReleases.queryOptions({
            input: { nodeId: props.nodeId },
          }).queryKey,
        }),
      ]);
      setUnpublishOpen(false);
      toast.success(toolbarCopy.unpublishDone);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });
  const showsPrimary =
    canPublish && showButton && (!buttonWhenNeeded || needsPublication || hasPublicSite);
  const unpublishItem = (
    <DropdownMenuItem
      data-airapp-unpublish=""
      disabled={unpublish.isPending || publicationBusy}
      onSelect={(event) => {
        rememberMenuTrigger(event.currentTarget as HTMLElement | null);
        setUnpublishOpen(true);
      }}
    >
      <GlobeLock aria-hidden="true" className="mr-2 size-3.5" />
      {toolbarCopy.unpublish}
    </DropdownMenuItem>
  );
  const publishButton =
    showsPrimary && placement === "toolbar" ? (
      <div className="inline-flex shrink-0 items-center" data-airapp-publication-controls="">
        <TooltipProvider delayDuration={350}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={label}
                className={`${compact ? "h-8 shrink-0 gap-1.5 px-2.5" : ""} ${hasPublicSite ? "rounded-r-none" : ""}`}
                data-airapp-publish-to-site=""
                disabled={site.isPending || unpublish.isPending || publicationBusy}
                onClick={() => {
                  unpublishReturnFocus.current = null;
                  setOpen(true);
                }}
                ref={publishTrigger}
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
                <span>{label}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">{label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {hasPublicSite ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={toolbarCopy.publicationActions}
                className="h-8 shrink-0 rounded-l-none border-primary-foreground/20 border-l px-2"
                data-airapp-publication-actions=""
                disabled={unpublish.isPending || publicationBusy}
                size="sm"
                type="button"
              >
                <ChevronDown aria-hidden="true" className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">{unpublishItem}</DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    ) : null;
  const publishMenuItem =
    canPublish && placement === "menu" ? (
      <div className="flex items-stretch px-1 py-2" data-airapp-publication-controls="">
        <DropdownMenuItem
          asChild
          className="bg-primary text-primary-foreground focus:bg-primary/90 focus:text-primary-foreground"
          disabled={site.isPending || unpublish.isPending || publicationBusy}
          onSelect={(event) => {
            rememberMenuTrigger(event.currentTarget as HTMLElement | null);
            setOpen(true);
          }}
        >
          <Button
            className={`h-9 min-w-0 flex-1 justify-center gap-1.5 rounded-full px-3 ${hasPublicSite ? "rounded-r-none" : ""}`}
            data-airapp-publish-to-site=""
            disabled={site.isPending || unpublish.isPending || publicationBusy}
            size="sm"
            type="button"
          >
            <Globe aria-hidden="true" className="size-3.5" />
            <span>{label}</span>
          </Button>
        </DropdownMenuItem>
        {hasPublicSite ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              aria-label={toolbarCopy.publicationActions}
              className="h-9 shrink-0 rounded-l-none rounded-r-full border-primary-foreground/20 border-l bg-primary px-3 text-primary-foreground focus:bg-primary/90 data-[state=open]:bg-primary/90 data-[disabled]:opacity-50 [&>svg:last-child]:m-0 [&>svg:last-child]:rotate-90"
              data-airapp-publication-actions=""
              disabled={unpublish.isPending || publicationBusy}
            />
            <DropdownMenuPortal>
              <DropdownMenuSubContent>{unpublishItem}</DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        ) : null}
      </div>
    ) : canPublish && !showsPrimary ? (
      <DropdownMenuItem
        data-airapp-publish-to-site=""
        disabled={publicationBusy}
        onSelect={() => setOpen(true)}
      >
        <Globe aria-hidden="true" className="mr-2 size-3.5" />
        {label}
      </DropdownMenuItem>
    ) : null;

  return (
    <>
      {renderButtons ? renderButtons(publishButton, null, publishMenuItem) : publishButton}
      {children?.(publishMenuItem)}
      {/* Menu content unmounts on selection; keep the publishing flow outside it. */}
      {canPublish && open ? (
        <PublishDialog
          {...props}
          onClose={() => setOpen(false)}
          onCloseAutoFocus={restorePublicationFocus}
        />
      ) : null}
      {canPublish ? (
        <AlertDialog
          onOpenChange={(next) => {
            if (!unpublish.isPending) setUnpublishOpen(next);
          }}
          open={unpublishOpen}
        >
          <AlertDialogContent
            data-airapp-unpublish-dialog=""
            onCloseAutoFocus={restorePublicationFocus}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>{toolbarCopy.unpublishTitle}</AlertDialogTitle>
              <AlertDialogDescription>{toolbarCopy.unpublishDescription}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={unpublish.isPending}>
                {messages.common.cancel}
              </AlertDialogCancel>
              <Button
                aria-busy={unpublish.isPending}
                disabled={unpublish.isPending || publicationBusy || !site.data?.isPublic}
                onClick={() => unpublish.mutate()}
                type="button"
                variant="destructive"
              >
                {unpublish.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {toolbarCopy.unpublish}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}

function PublishDialog({
  orpc,
  nodeId,
  nodeName,
  filesRevision,
  onClose,
  onCloseAutoFocus,
}: AirAppPublishToSiteProps & {
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const toolbarCopy = airAppToolbarMessages[locale];
  const integration = useAgentIntegrationTarget();
  const copy = messages.airapp.site.publish;
  const planGate = useAirAppEnginePlanGate();
  const client = useQueryClient();
  const options = orpc.airapps.siteState.queryOptions({ input: { nodeId } });
  // A newly opened dialog always checks the plan and the saved app files again.
  const query = useQuery({ ...options, staleTime: 0, refetchOnMount: "always", retry: false });
  const state = query.data;
  const environmentOptions = orpc.airapps.siteEnvironment?.queryOptions({ input: { nodeId } });
  const environment = useQuery({
    ...(environmentOptions ?? {
      queryKey: ["unsupported-site-environment", nodeId],
      queryFn: async (): Promise<AirAppSiteEnvironmentVO> => ({
        available: false,
        sources: [],
        bindings: [],
      }),
    }),
    enabled:
      Boolean(environmentOptions) &&
      state?.engine === "available" &&
      !readSiteAccessDenial(query.error) &&
      !siteDeploymentDenial(state),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  const publishLabel =
    state?.isPublic && state.liveVersion ? toolbarCopy.publishUpdate : toolbarCopy.publish;
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState<SiteAccessDenial | null>(null);
  const [preparedVersion, setPreparedVersion] = useState<string | null>(null);
  const [preparedUrl, setPreparedUrl] = useState<string | null>(null);
  const [reviewedVersion, setReviewedVersion] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewport, setViewport] = useState<AirAppViewportSize>("desktop");
  const autoPrepared = useRef(false);
  const reviewGeneration = useRef(0);
  const currentFilesRevision = useRef(filesRevision);
  const buildingFilesRevision = useRef(filesRevision);
  const lastFilesRevision = useRef(filesRevision);
  const stateCheckGeneration = useRef(0);
  const [checkedFilesRevision, setCheckedFilesRevision] = useState(filesRevision);
  currentFilesRevision.current = filesRevision;
  const refetchState = useCallback(async () => {
    const revision = currentFilesRevision.current;
    const generation = ++stateCheckGeneration.current;
    const result = await query.refetch();
    if (
      result.isSuccess &&
      generation === stateCheckGeneration.current &&
      revision === currentFilesRevision.current
    )
      setCheckedFilesRevision(revision);
    return result;
  }, [query.refetch]);

  useEffect(() => {
    if (lastFilesRevision.current === filesRevision) return;
    lastFilesRevision.current = filesRevision;
    // Source edits require a fresh bundle comparison, not another iframe load.
    // README and other excluded files can change without invalidating its review.
    void refetchState();
  }, [filesRevision, refetchState]);

  useEffect(
    () => () => {
      reviewGeneration.current += 1;
      stateCheckGeneration.current += 1;
    },
    [],
  );
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
    onMutate: async () => {
      reviewGeneration.current += 1;
      stateCheckGeneration.current += 1;
      buildingFilesRevision.current = currentFilesRevision.current;
      setError(null);
      setPreparedVersion(null);
      setReviewedVersion(null);
      // A readiness check started before this build must not replace its result.
      await client.cancelQueries({ queryKey: options.queryKey });
    },
    onSuccess: (result) => {
      actionResult(result);
      if (result.outcome === "ok") {
        setPreparedVersion(result.state.previewVersion);
        setPreparedUrl(
          result.state.previewShareUrl ??
            (result.state.previewUrl && result.state.previewVersion
              ? `${result.state.previewUrl}?__busabase_site_version=${encodeURIComponent(result.state.previewVersion)}`
              : null),
        );
      }
      if (buildingFilesRevision.current !== currentFilesRevision.current) void refetchState();
    },
    onError: (cause) => {
      const denial = readSiteAccessDenial(cause);
      setAccessDenied(denial);
      setError(denial ? null : cause instanceof Error ? cause.message : String(cause));
      if (!denial) void refetchState();
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
        toast.success(messages.airapp.site.goLiveDone);
      }
    },
    onError: (cause) => {
      const denial = readSiteAccessDenial(cause);
      setAccessDenied(denial);
      setError(denial ? null : cause instanceof Error ? cause.message : String(cause));
      if (!denial) void refetchState();
    },
  });
  const preparePreview = preview.mutate;
  useEffect(() => {
    if (
      autoPrepared.current ||
      !query.isFetchedAfterMount ||
      query.isFetching ||
      query.isError ||
      (environmentOptions && environment.isPending) ||
      state?.engine !== "available" ||
      state.blockers.length > 0
    )
      return;
    // Register this member's preview even when the saved version is already live.
    // A failed attempt stays manual, so errors never trigger a deployment loop.
    autoPrepared.current = true;
    // Fixing bindings in another tab restores the action but does not deploy.
    if (state.environmentDeploymentLock || accessDenied) return;
    preparePreview();
  }, [
    query.isFetchedAfterMount,
    query.isFetching,
    query.isError,
    environmentOptions,
    environment.isPending,
    state,
    preparePreview,
    accessDenied,
  ]);

  const denial = accessDenied ?? readSiteAccessDenial(query.error) ?? siteDeploymentDenial(state);
  const permissionMessage = denial
    ? siteAccessMessage(messages.airapp.site.environment, denial)
    : null;
  const busy = preview.isPending || publish.isPending;
  const locked = state?.engine === "locked" || Boolean(state?.publicationLock);
  const configured = state?.engine === "available" || state?.engine === "locked";
  const blockers = state?.blockers ?? [];
  const previewVersion = state?.previewVersion;
  const previewUrl =
    state?.previewUrl && previewVersion && preparedVersion === previewVersion
      ? `${state.previewUrl}?__busabase_site_version=${encodeURIComponent(previewVersion)}`
      : null;
  // Keep the address bar and its refresh control in place while a new private
  // preview is prepared. Publication still waits for the new iframe to load.
  const toolbarPreviewUrl = previewUrl
    ? state?.previewShareUrl === null
      ? null
      : (state?.previewShareUrl ?? previewUrl)
    : preview.isPending
      ? preparedUrl
      : null;
  const shareable = Boolean(state?.previewShareUrl && toolbarPreviewUrl === state.previewShareUrl);
  const canPublish =
    state &&
    !denial &&
    !query.isError &&
    !query.isFetching &&
    !(environmentOptions && environment.isPending) &&
    checkedFilesRevision === filesRevision &&
    blockers.length === 0 &&
    canGoLive(state) &&
    reviewedVersion === previewVersion;

  const alreadyLive = Boolean(
    state?.isPublic &&
      state.liveVersion &&
      state.liveVersion === state.currentVersion &&
      !state.liveEnvironmentStale,
  );
  const nextStep = publish.isPending
    ? messages.common.working
    : query.isPending || query.isFetching
      ? copy.checking
      : query.isError
        ? copy.checkFailed
        : preview.isPending
          ? copy.preparingPreview
          : locked
            ? copy.upgradeHint
            : !configured
              ? messages.airapp.engineNotConfigured
              : blockers.length
                ? copy.prepareHint
                : alreadyLive
                  ? copy.alreadyLive
                  : state?.previewStale
                    ? copy.previewStale
                    : !previewUrl
                      ? copy.noPreview
                      : reviewedVersion !== previewVersion
                        ? copy.checking
                        : copy.readyToPublish;

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open
    >
      <DialogContent
        className="flex max-h-[90dvh] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        data-airapp-publish-dialog=""
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="shrink-0 border-border border-b px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Globe aria-hidden="true" className="size-4" />
            {publishLabel}
          </DialogTitle>
          <DialogDescription className="sr-only">{copy.preserveBrowser}</DialogDescription>
        </DialogHeader>
        <div
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4"
          data-airapp-publish-scroll=""
        >
          {query.isError ? (
            <div className="space-y-2" role="alert">
              <p className="text-destructive text-sm">
                {permissionMessage ??
                  (query.error instanceof Error ? query.error.message : copy.checkFailed)}
              </p>
              {!denial ? (
                <Button onClick={() => void refetchState()} size="sm" variant="outline">
                  {messages.common.retry}
                </Button>
              ) : null}
            </div>
          ) : null}
          {state && !query.isError ? (
            <>
              {locked ? (
                <p className="text-sm">
                  {planGate || state.publicationLock
                    ? fmt(copy.planRequired, {
                        plan: planGate?.planLabel ?? state.publicationLock?.planLabel ?? "",
                      })
                    : copy.paidPlanRequired}
                </p>
              ) : null}
              {configured && blockers.length > 0 ? (
                <div className="space-y-3">
                  <p className="font-medium text-sm">{copy.prepareTitle}</p>
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground text-sm">
                    {blockers.map((blocker) => (
                      <li key={JSON.stringify(blocker)}>
                        {airAppSiteBlockerMessage(messages, blocker)}
                      </li>
                    ))}
                  </ul>
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
              {state.engine === "available" && blockers.length === 0 ? (
                <div className="space-y-3">
                  {environmentOptions ? (
                    <section className="space-y-2" data-airapp-site-publish-configuration="">
                      {environment.isPending ? (
                        <p className="text-muted-foreground text-xs" role="status">
                          {messages.airapp.site.environment.loading}
                        </p>
                      ) : environment.isError ? (
                        <div className="space-y-2" role="alert">
                          <p className="text-destructive text-xs">
                            {messages.airapp.site.environment.loadFailed}
                          </p>
                          <Button
                            onClick={() => void environment.refetch()}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            {messages.airapp.site.environment.retry}
                          </Button>
                        </div>
                      ) : environment.data?.available ? (
                        <>
                          <AirAppSiteConfigurationList
                            directValues={environment.data.directValues ?? []}
                            bindings={environment.data.bindings}
                          />
                          {environment.data.unboundDirectValues?.length ? (
                            <div
                              className="space-y-1 text-muted-foreground text-xs"
                              data-airapp-site-publish-unbound=""
                              role="status"
                            >
                              <p className="font-medium">
                                {messages.airapp.site.environment.unboundTitle}
                              </p>
                              <p>{messages.airapp.site.environment.unboundDescription}</p>
                              <p className="break-all font-mono">
                                {environment.data.unboundDirectValues
                                  .map((item) => item.envName)
                                  .join(", ")}
                              </p>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      <a
                        className="text-primary text-xs underline underline-offset-2"
                        href={(() => {
                          const url = new URL(window.location.href);
                          url.searchParams.set("siteEnvironment", "1");
                          return `${url.pathname}${url.search}`;
                        })()}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {messages.airapp.site.environment.title} ↗
                      </a>
                    </section>
                  ) : null}
                  {(!toolbarPreviewUrl && !previewUrl) || state.previewStale ? (
                    <Button
                      className="gap-1.5"
                      disabled={
                        busy ||
                        query.isFetching ||
                        Boolean(denial) ||
                        Boolean(environmentOptions && environment.isPending)
                      }
                      onClick={() => preview.mutate()}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {preview.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      {preview.isPending ? copy.preparingPreview : copy.createPreview}
                    </Button>
                  ) : null}
                  {toolbarPreviewUrl || previewUrl ? (
                    <div className="space-y-2">
                      <AirAppPreviewTools
                        kind="site"
                        onRefresh={() => preview.mutate()}
                        previewAvailable={Boolean(previewUrl || (preview.isPending && preparedUrl))}
                        refreshDisabled={
                          busy ||
                          query.isFetching ||
                          Boolean(denial) ||
                          Boolean(environmentOptions && environment.isPending)
                        }
                        refreshLabel={copy.refreshPreview}
                        refreshing={preview.isPending}
                        shareable={shareable}
                        sharingDisabled={
                          reviewedVersion !== previewVersion ||
                          query.isFetching ||
                          checkedFilesRevision !== filesRevision ||
                          state.previewStale ||
                          !previewUrl
                        }
                        setViewport={setViewport}
                        url={toolbarPreviewUrl}
                        viewport={viewport}
                      />
                      <AirAppPreviewViewport
                        frameKey={previewUrl ?? undefined}
                        onLoad={async () => {
                          if (!previewUrl || state.previewStale) return;
                          const generation = reviewGeneration.current;
                          try {
                            let response = await fetch(previewUrl, {
                              method: "HEAD",
                              credentials: "same-origin",
                              cache: "no-store",
                              signal: AbortSignal.timeout(15_000),
                            });
                            if (response.status === 405 || response.status === 501)
                              response = await fetch(previewUrl, {
                                credentials: "same-origin",
                                cache: "no-store",
                                signal: AbortSignal.timeout(15_000),
                              });
                            if (!response.ok) throw new Error(copy.previewUnavailable);
                            if (generation !== reviewGeneration.current) return;
                            setError(null);
                            setReviewedVersion(previewVersion ?? null);
                          } catch {
                            if (generation !== reviewGeneration.current) return;
                            setError(copy.previewUnavailable);
                            setReviewedVersion(null);
                          }
                        }}
                        src={previewUrl}
                        title={copy.previewTitle}
                        wrapFrame={(frame) => (
                          <AirAppPreviewFrame className="h-64 sm:h-80" viewport={viewport}>
                            {frame}
                          </AirAppPreviewFrame>
                        )}
                        fallback={
                          <div
                            className="grid h-64 place-items-center text-muted-foreground text-sm"
                            role="status"
                          >
                            {copy.preparingPreview}
                          </div>
                        }
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <DialogFooter
          className="block shrink-0 space-y-3 border-border border-t px-5 py-4"
          data-airapp-publish-footer=""
        >
          <p
            className={error ? "text-destructive text-sm" : "text-muted-foreground text-sm"}
            data-airapp-site-access-denied={denial ? "" : undefined}
            role={error || denial ? "alert" : "status"}
          >
            {permissionMessage ?? error ?? nextStep}
          </p>
          {canPublish && !locked ? (
            <div className="space-y-1 text-muted-foreground text-xs leading-relaxed">
              <p>{copy.publishConsent}</p>
              <p data-airapp-site-environment-publish-note="">
                {messages.airapp.site.environment.latestOnPublish}
              </p>
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button onClick={onClose} type="button" variant="outline">
              {messages.common.close}
            </Button>
            {locked && planGate?.onUpgrade ? (
              <Button
                className="gap-1.5"
                onClick={() => {
                  onClose();
                  planGate.onUpgrade?.();
                }}
                type="button"
              >
                <ArrowUpCircle className="size-3.5" />
                {fmt(messages.airapp.enginePlan.upgrade, { plan: planGate.planLabel })}
              </Button>
            ) : state?.engine === "available" && blockers.length === 0 && !query.isError ? (
              <Button
                aria-busy={publish.isPending}
                disabled={!canPublish || busy}
                onClick={() => publish.mutate()}
                type="button"
              >
                {publish.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {publishLabel}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
