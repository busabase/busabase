"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AirAppSiteActionVO,
  AirAppSiteBlocker,
  AirAppSitePublication,
  AirAppSiteStateVO,
} from "busabase-contract/domains/airapp/contract";
import { Button } from "kui/button";
import { Label } from "kui/label";
import { Switch } from "kui/switch";
import { ExternalLink, Globe, Loader2, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { fmt, useCoreI18n } from "../../../i18n";
import type { AirAppRunStatus } from "../store/airapp-runner-store";
import { AirAppSiteDomains } from "./AirAppSiteDomains";

type CoreMessages = ReturnType<typeof useCoreI18n>;

const formatBytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** One blocker in the viewer's locale. Exhaustive, so a new code cannot ship unworded. */
export const airAppSiteBlockerMessage = (
  messages: CoreMessages,
  blocker: AirAppSiteBlocker,
): string => {
  const copy = messages.airapp.site.blockers;
  switch (blocker.code) {
    case "not-a-site-app":
    case "python-runtime":
      return copy[blocker.code];
    case "invalid-manifest":
      return fmt(copy[blocker.code], { detail: blocker.detail });
    case "unsafe-path":
    case "entry-missing":
    case "entry-not-javascript":
    case "entry-no-default-export":
    case "no-index-page":
      return fmt(copy[blocker.code], { path: blocker.path });
    case "entry-syntax-error":
      return fmt(copy[blocker.code], { path: blocker.path, detail: blocker.detail });
    case "unsupported-import":
      return fmt(copy[blocker.code], { path: blocker.path, specifier: blocker.specifier });
    case "asset-too-large":
      return fmt(copy[blocker.code], { path: blocker.path, size: formatBytes(blocker.size) });
    case "too-many-assets":
      return fmt(copy[blocker.code], { count: String(blocker.count) });
    default: {
      const exhaustive: never = blocker;
      throw new Error(`Unknown site blocker: ${JSON.stringify(exhaustive)}`);
    }
  }
};

/** What is stopping the app, in place of a preview that does not exist. */
export function AirAppSiteBlockers({ blockers }: { blockers: readonly AirAppSiteBlocker[] }) {
  const messages = useCoreI18n();
  return (
    <div
      aria-live="polite"
      className="notranslate grid h-full min-h-[160px] place-items-center p-6"
      data-airapp-site-blockers=""
      role="status"
      translate="no"
    >
      <div className="flex max-w-md flex-col gap-3">
        <p className="flex items-center gap-2 font-medium text-foreground text-sm">
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-destructive" />
          {messages.airapp.site.blockedTitle}
        </p>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground text-xs">
          {blockers.map((blocker) => (
            <li data-airapp-site-blocker={blocker.code} key={JSON.stringify(blocker)}>
              {airAppSiteBlockerMessage(messages, blocker)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const useSiteState = (orpc: BusabaseQueryUtils, nodeId: string) =>
  useQuery(orpc.airapps.siteState.queryOptions({ input: { nodeId } }));

const publicationLabel = (messages: CoreMessages, publication: AirAppSitePublication): string =>
  ({
    "not-live": messages.airapp.site.statusNotLive,
    live: messages.airapp.site.statusLive,
    "live-with-changes": messages.airapp.site.statusLiveWithChanges,
  })[publication];

/** Whether Go live has something to do right now. */
export const canGoLive = (state: AirAppSiteStateVO): boolean =>
  state.engine === "available" &&
  state.previewVersion !== null &&
  !state.previewStale &&
  (state.previewVersion !== state.liveVersion || !state.isPublic);

/** The reason Go live is unavailable, when the person has something to do about it. */
export const goLiveNote = (messages: CoreMessages, state: AirAppSiteStateVO): string | null => {
  if (state.engine !== "available" || state.blockers.length > 0) return null;
  if (state.previewVersion === null) return messages.airapp.site.noPreview;
  return state.previewStale ? messages.airapp.site.previewStale : null;
};

const siteErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The Go live button and the site's state, beside Run. */
export function AirAppSiteGoLive({
  orpc,
  nodeId,
  runStatus,
  filesRevision,
}: {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  runStatus: AirAppRunStatus;
  /** Changes when the app's files do, which is what makes a preview stale. */
  filesRevision: string;
}) {
  const messages = useCoreI18n();
  const { data: state, refetch } = useSiteState(orpc, nodeId);

  // A finished deploy or an edited file changes the answer; the query cannot see either.
  // biome-ignore lint/correctness/useExhaustiveDependencies: filesRevision is the trigger
  useEffect(() => {
    if (runStatus === "ready" || runStatus === "error") void refetch();
  }, [runStatus, filesRevision, refetch]);

  const goLive = useMutation({
    mutationFn: () => orpc.airapps.siteGoLive.call({ nodeId }),
    onSuccess: async ({ outcome, state: next }: AirAppSiteActionVO) => {
      await refetch();
      if (outcome === "ok") toast.success(messages.airapp.site.goLiveDone);
      if (outcome === "preview-stale") toast.error(messages.airapp.site.previewStale);
      if (outcome === "no-preview") toast.error(messages.airapp.site.noPreview);
      if (outcome === "blocked") {
        const first = next.blockers[0];
        toast.error(first ? airAppSiteBlockerMessage(messages, first) : messages.airapp.runFailed);
      }
    },
    onError: (error) => toast.error(siteErrorMessage(error)),
  });

  if (!state || state.engine === "not-offered") return null;
  const note = goLiveNote(messages, state);

  return (
    <div className="flex items-center gap-1.5" data-airapp-site-publication={state.publication}>
      {note ? (
        <span
          className="hidden max-w-64 truncate text-muted-foreground text-xs lg:inline"
          data-airapp-site-note=""
          title={note}
        >
          {note}
        </span>
      ) : null}
      <span className="text-muted-foreground text-xs">
        {publicationLabel(messages, state.publication)}
      </span>
      {state.publication !== "not-live" && state.address ? (
        <Button
          aria-label={state.address}
          asChild
          size="icon-sm"
          title={state.address}
          variant="outline"
        >
          <a href={state.address} rel="noreferrer" target="_blank">
            <ExternalLink className="size-3.5" />
          </a>
        </Button>
      ) : null}
      <Button
        data-airapp-site-go-live=""
        disabled={!canGoLive(state) || goLive.isPending || runStatus === "starting"}
        onClick={() => goLive.mutate()}
        size="sm"
        type="button"
      >
        {goLive.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Globe className="size-3.5" />
        )}
        {messages.airapp.site.goLive}
      </Button>
    </div>
  );
}

/** The site's address and public switch, in the AirApp's settings. */
export function AirAppSiteSettings({ orpc, nodeId }: { orpc: BusabaseQueryUtils; nodeId: string }) {
  const messages = useCoreI18n();
  const copy = messages.airapp.site;
  const { data: state, refetch } = useSiteState(orpc, nodeId);

  const setPublic = useMutation({
    mutationFn: (next: boolean) =>
      next
        ? orpc.airapps.siteRepublish.call({ nodeId })
        : orpc.airapps.siteUnpublish.call({ nodeId }),
    onSuccess: () => refetch(),
    onError: (error) => toast.error(siteErrorMessage(error)),
  });

  if (!state?.address) return null;
  const hasLiveVersion = state.liveVersion !== null;
  // A locked plan may take a site down but not put one back up.
  const switchDisabled =
    !hasLiveVersion || setPublic.isPending || (state.engine !== "available" && !state.isPublic);

  return (
    <div
      className="space-y-3 rounded-md border border-border px-3 py-2"
      data-airapp-site-settings=""
    >
      <div className="space-y-1">
        <p className="font-medium text-foreground text-sm">{copy.addressLabel}</p>
        {state.publication === "not-live" ? (
          <p className="break-all text-muted-foreground text-xs" data-airapp-site-address="">
            {state.address}
          </p>
        ) : (
          <a
            className="break-all text-primary text-xs underline-offset-2 hover:underline"
            data-airapp-site-address=""
            href={state.address}
            rel="noreferrer"
            target="_blank"
          >
            {state.address}
          </a>
        )}
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor="node-settings-airapp-site-public">{copy.publicLabel}</Label>
          <p className="text-muted-foreground text-xs">
            {!hasLiveVersion
              ? copy.publicNotYet
              : state.isPublic
                ? copy.publicOnHint
                : copy.publicOffHint}
          </p>
        </div>
        <Switch
          checked={state.isPublic}
          data-airapp-site-public=""
          disabled={switchDisabled}
          id="node-settings-airapp-site-public"
          onCheckedChange={(next) => setPublic.mutate(next)}
        />
      </div>
      <AirAppSiteDomains nodeId={nodeId} orpc={orpc} state={state} />
    </div>
  );
}
