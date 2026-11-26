"use client";

import { useQuery } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AirAppSiteStateVO } from "busabase-contract/domains/airapp/contract";
import type { AirAppVO } from "busabase-contract/types";
import { Button } from "kui/button";
import { DropdownMenuItem } from "kui/dropdown-menu";
import { TabsContent } from "kui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "kui/tooltip";
import {
  ArrowUpCircle,
  Check,
  CircleStop,
  Cloud,
  Copy,
  Globe,
  History,
  Laptop,
  Loader2,
  Lock,
  Maximize,
  Monitor,
  Pin,
  Play,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { airAppToolbarMessages } from "../../../i18n/airapp-toolbar";
import { NodeSettingsDialog } from "../../dashboard/components/node-settings-dialog";
import {
  FullscreenPreviewSurface,
  type PreviewFullscreenState,
  usePreviewFullscreen,
} from "../../dashboard/components/preview-fullscreen";
import { EmptyState } from "../../dashboard/components/primitives";
import { NodeDetailSkeleton } from "../../dashboard/components/skeletons";
import { useWorkspacePermissionLevel } from "../../dashboard/components/split-submit-button";
import { asNodeDetail } from "../../dashboard/helpers/node-detail";
import type { SidePanelTabProps } from "../../dashboard/side-panel-registry";
import { useSidePanelStore } from "../../dashboard/store/side-panel-store";
import { useIsAnonymousVisitor } from "../../dashboard/visitor-context";
import { useAirAppBrowserLogs } from "../hooks/use-airapp-browser-logs";
import { type AirAppPreviewState, useAirAppPreviewState } from "../hooks/use-airapp-preview-state";
import { type AirAppSiteViewsState, useAirAppSiteViews } from "../hooks/use-airapp-site-views";
import { airAppSidePanelTabId } from "../store/airapp-keepalive-store";
import {
  type AirAppRunEntry,
  type AirAppRunStatus,
  DEFAULT_RUNNER_KIND,
  IDLE_ENTRY,
  useAirAppRunnerStore,
} from "../store/airapp-runner-store";
import {
  AIRAPP_MANIFEST_PATH,
  type AirAppRuntimeKind,
  resolveRunPlan,
} from "../utils/airapp-runtime-descriptor";
import {
  type AirAppEngineLockState,
  preferredEngineFallbackLogLine,
  readAirAppEnginePlanRefusal,
  resolveEngineWithPlan,
  resolvePreferredEngineFallback,
} from "../utils/engine-plan-gate";
import { NodepodServiceWorkerError } from "../utils/nodepod-service-worker";
import { readSiteAccessDenial, siteAccessMessage } from "../utils/site-access";
import { renderTerminalOutput } from "../utils/terminal-output";
import { AirAppFilesPanel } from "./AirAppFilesPanel";
import { AirAppPreviewMenu } from "./AirAppPreviewMenu";
import { AirAppPreviewFrame, absolutePreviewUrl } from "./AirAppPreviewTools";
import { AirAppPreviewViewport } from "./AirAppPreviewViewport";
import { AirAppPublishToSite } from "./AirAppPublishToSite";
import { AirAppSiteBlockers, AirAppSiteGoLive } from "./AirAppSiteControls";
import { AirAppSiteLogs } from "./AirAppSiteLogs";
import {
  AirAppSiteContextActions,
  AirAppSiteModeSwitch,
  AirAppSiteToolbarActions,
} from "./AirAppSiteViews";
import {
  useAirAppEngineAvailability,
  useAirAppEnginePlanGate,
  useAirAppEnginesNotConfigured,
} from "./engine-availability-context";
import { createAirAppRunner } from "./runners/runner-factory";
import { AirAppSiteBlockedError } from "./runners/site-runner";
import type { AirAppMountedFile, AirAppRunnerKind } from "./runners/types";

/**
 * How long a node must stay open before a run that costs something is started.
 *
 * Opening an AirApp runs it, which is the right feel for a document and the
 * wrong one for a bill: clicking down a folder of AirApps would otherwise
 * provision a machine for each node passed through. The `browser` engine is
 * exempt — its run is free and instant, so debouncing it would only make the
 * good case slower.
 */
const REMOTE_AUTO_RUN_DWELL_MS = 1200;

/** Engines whose runs are free and instant, so opening a node may start them at once. */
const FREE_ENGINES: AirAppRunnerKind[] = ["browser"];

export const airAppAutoRunDelay = (
  selectionsHydrated: boolean,
  selected: AirAppRunnerKind,
): number | null => {
  if (!selectionsHydrated) return null;
  return FREE_ENGINES.includes(selected) ? 0 : REMOTE_AUTO_RUN_DWELL_MS;
};

type EligibleAirAppRunner<T> =
  | { runnerKind: AirAppRunnerKind; runner: T }
  /** `lockedEngine` is set when only the space's plan stands in the way. */
  | { runnerKind: null; runner: null; lockedEngine?: AirAppRunnerKind };

/**
 * Resolve compatibility before constructing a runner. Keeping the factory
 * behind this gate makes the important negative guarantee executable: a
 * Python AirApp on a browser-only deployment never boots a browser runner.
 */
export const createEligibleAirAppRunner = <T,>({
  runtime,
  preferredEngine,
  requiredEngine,
  userChose,
  wantedKind,
  availableEngines,
  lockedEngines = [],
  createRunner,
}: {
  runtime: AirAppRuntimeKind;
  preferredEngine?: AirAppRunnerKind;
  requiredEngine?: AirAppRunnerKind;
  /** Whether `wantedKind` is a choice the user made, or merely the default. */
  userChose: boolean;
  wantedKind: AirAppRunnerKind;
  availableEngines: readonly AirAppRunnerKind[];
  /**
   * Engines the deployment has that this space's plan leaves out. They are
   * never constructed; they only turn "nothing can run this" into "the plan
   * can", which the caller renders as the upgrade state.
   */
  lockedEngines?: readonly AirAppRunnerKind[];
  createRunner: (kind: AirAppRunnerKind) => T;
}): EligibleAirAppRunner<T> => {
  const resolution = resolveEngineWithPlan(
    runtime,
    // The person outranks the file. `preferredEngine` is what the app's author
    // (usually an agent) put in `airapp.json`; `wantedKind` is what the person
    // looking at the node chose in its settings. Only when they have chosen
    // nothing does the manifest get to decide.
    //
    // It used to be `preferredEngine ?? wantedKind` — the manifest always won,
    // silently, and the settings dialog showed a value that was not what would
    // happen. Neither the dialog nor the logs said the file had an opinion.
    userChose ? wantedKind : (preferredEngine ?? wantedKind),
    { available: [...availableEngines], locked: [...lockedEngines] },
    requiredEngine,
  );
  if (resolution.kind === "locked") {
    return { runnerKind: null, runner: null, lockedEngine: resolution.engine };
  }
  if (resolution.kind === "unavailable") return { runnerKind: null, runner: null };
  return { runnerKind: resolution.engine, runner: createRunner(resolution.engine) };
};

/**
 * The `[busabase]` line a run opens with when it is not on the engine anyone
 * would assume, or `null` when there is nothing to say.
 *
 * Two different facts, worded differently. When `airapp.json` decided (nobody
 * overrode it) and the run moved off its `preferredEngine`, the line names the
 * preference and why it was set aside — on a Free Cloud space an app preferring
 * the Website runs in the browser, and before this line the log never said so,
 * because "browser" is also the default it was compared against. Otherwise the
 * long-standing "engine selected" line reports a run that moved off the
 * person's choice or the default.
 */
export const airAppEngineNote = ({
  runtime,
  preferredEngine,
  userChose,
  wantedKind,
  runnerKind,
  availableEngines,
  lockedEngines = [],
}: {
  runtime: AirAppRuntimeKind;
  preferredEngine?: AirAppRunnerKind;
  userChose: boolean;
  wantedKind: AirAppRunnerKind;
  runnerKind: AirAppRunnerKind;
  availableEngines: readonly AirAppRunnerKind[];
  lockedEngines?: readonly AirAppRunnerKind[];
}): string | null => {
  const fallback = userChose
    ? null
    : resolvePreferredEngineFallback({
        preferred: preferredEngine,
        engine: runnerKind,
        offer: { available: [...availableEngines], locked: [...lockedEngines] },
      });
  if (fallback) return preferredEngineFallbackLogLine(fallback, runtime);
  if (runnerKind !== wantedKind) {
    return `[busabase] engine "${runnerKind}" selected for runtime "${runtime}"\n`;
  }
  return null;
};

export const noEligibleAirAppEngineMessage = (
  messages: ReturnType<typeof useCoreI18n>,
  runtime: AirAppRuntimeKind,
  requiredEngine?: AirAppRunnerKind,
): string =>
  requiredEngine
    ? messages.airapp.requiredEngineUnavailable[requiredEngine]
    : runtime === "python"
      ? messages.airapp.pythonNeedsSandock
      : fmt(messages.airapp.noEligibleEngine, { runtime });

/** The error text to show for a run entry, worded in the viewer's current
 *  locale whenever the failure is a known fact rather than a runner's own
 *  output. */
export const airAppRunErrorText = (
  messages: ReturnType<typeof useCoreI18n>,
  entry: Pick<AirAppRunEntry, "error" | "engineUnavailable">,
): string | null =>
  entry.engineUnavailable
    ? noEligibleAirAppEngineMessage(
        messages,
        entry.engineUnavailable.runtime,
        entry.engineUnavailable.requiredEngine,
      )
    : entry.error;

const airAppFilesRevision = (files: AirAppVO["files"]): string =>
  JSON.stringify(
    files
      .map((file) => [file.path, file.updatedAt] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

interface AirAppRunOptions {
  sitePreview?: boolean;
}

/**
 * Owns the AirApp runner lifecycle (mount/install/start, log streaming,
 * preview URL) independent of which tab is currently visible. Called once at
 * the AirAppDetailView level so switching between the App/Files/Logs tabs
 * never unmounts this state and never disposes a live running app.
 *
 * The actual runner metadata lives in `useAirAppRunnerStore`, keyed by node
 * id, while `AirAppKeepAliveHost` keeps each visited detail/iframe DOM tree
 * mounted by slug. That separation preserves both host-side runner state and
 * the AirApp document's own JavaScript memory when navigating between nodes.
 * Disposal only happens through an explicit action such as successful node
 * deletion; ordinary navigation only CSS-hides the inactive iframe.
 */
export function useAirAppRunner({
  orpc,
  airapp,
}: {
  orpc: BusabaseQueryUtils;
  airapp: AirAppVO | null;
}) {
  const messages = useCoreI18n();
  const nodeId = airapp?.node.id ?? null;
  // Sorting makes a refetch that only reorders the listing a no-op.
  const filesRevision = useMemo(() => airAppFilesRevision(airapp?.files ?? []), [airapp?.files]);

  const selectEntry = useCallback(
    (state: ReturnType<typeof useAirAppRunnerStore.getState>) =>
      nodeId ? (state.entries[nodeId] ?? IDLE_ENTRY) : IDLE_ENTRY,
    [nodeId],
  );
  const entry = useAirAppRunnerStore(selectEntry);
  const {
    status,
    logLines,
    previewUrl,
    errorCode,
    engineLock,
    siteBlockers,
    siteAccessDenied,
    runnerKind,
  } = entry;
  const error = airAppRunErrorText(messages, entry);
  const selectionsHydrated = useAirAppRunnerStore((state) => state.selectionsHydrated);
  const availableEngines = useAirAppEngineAvailability();
  const planGate = useAirAppEnginePlanGate();

  useEffect(() => {
    if (!useAirAppRunnerStore.persist.hasHydrated()) {
      void useAirAppRunnerStore.persist.rehydrate();
    }
  }, []);

  const run = useCallback(
    async (options?: AirAppRunOptions) => {
      if (!airapp) {
        return;
      }
      const currentNodeId = airapp.node.id;
      const store = useAirAppRunnerStore.getState();
      // The override lives on the NODE now, not in this browser. `undefined` means
      // nobody has overridden it, which is what lets `airapp.json` decide — the
      // distinction the old `localStorage` map could only express by absence, and
      // the reason absence must stay meaningful.
      const savedEngine = airapp.node.settings?.airappEngine ?? null;
      const userChose = savedEngine !== null;
      const wantedKind = savedEngine ?? DEFAULT_RUNNER_KIND;

      // Which engine can actually run this app has to be settled BEFORE the
      // runner is constructed — and the answer lives in the app's own files. The
      // alternative (construct the stored default, then discover the mismatch
      // during install) is what would make opening a Python AirApp auto-start it
      // in the browser, a JavaScript-only runtime, and fail every single time.
      //
      // Only the manifest needs to be fetched: runtime inference keys off which
      // marker files exist, which the listing already tells us.
      let engineNote: string | null = null;
      let plan: ReturnType<typeof resolveRunPlan>;
      try {
        const probeFiles: Record<string, string> = {};
        for (const file of airapp.files) probeFiles[file.path] = "";
        if (airapp.files.some((file) => file.path === AIRAPP_MANIFEST_PATH)) {
          const manifest = await orpc.fileTrees.readFile.call({
            nodeId: currentNodeId,
            filePath: AIRAPP_MANIFEST_PATH,
            type: "airapp",
          });
          if (manifest.encoding === "utf8") probeFiles[AIRAPP_MANIFEST_PATH] = manifest.content;
        }
        plan = resolveRunPlan(probeFiles);
        if (options?.sitePreview) {
          // Refreshing a website must stay on its deployment path, even if an
          // edit now requests another engine. The server returns bundle blockers
          // instead of letting this action provision a different runtime.
          plan = { ...plan, requiredEngine: "site" };
          const active = useAirAppRunnerStore.getState().entries[currentNodeId];
          if (
            active &&
            (active.status === "loading-files" ||
              active.status === "installing" ||
              active.status === "starting")
          )
            return;
        }
      } catch (caught) {
        // A malformed `airapp.json` is named here rather than swallowed: falling
        // back to defaults would run something the author did not ask for.
        useAirAppRunnerStore
          .getState()
          .failBeforeRun(
            currentNodeId,
            wantedKind,
            caught instanceof Error ? caught.message : messages.airapp.runFailed,
          );
        return;
      }

      // A preference the host cannot satisfy falls back to an eligible engine.
      // A hard requirement, or a Python app on a browser-only deployment, stops
      // here without ever constructing an incompatible runner.
      const resolved = createEligibleAirAppRunner({
        runtime: plan.runtime,
        preferredEngine: plan.preferredEngine,
        requiredEngine: plan.requiredEngine,
        userChose,
        wantedKind,
        availableEngines,
        lockedEngines: planGate?.lockedEngines,
        createRunner: (kind) => createAirAppRunner(kind, { orpc, nodeId: currentNodeId }),
      });
      if (!resolved.runnerKind && resolved.lockedEngine && planGate) {
        // Not "this deployment can't run this app": it can, the moment the
        // space upgrades. Say that, and offer the way there.
        store.failBeforeRun(
          currentNodeId,
          resolved.lockedEngine,
          fmt(messages.airapp.enginePlan.lockedTitle, { plan: planGate.planLabel }),
          { engine: resolved.lockedEngine, planLabel: planGate.planLabel },
        );
        return;
      }
      if (!resolved.runnerKind) {
        store.failBeforeRun(
          currentNodeId,
          plan.requiredEngine ?? wantedKind,
          noEligibleAirAppEngineMessage(messages, plan.runtime, plan.requiredEngine),
          undefined,
          { runtime: plan.runtime, requiredEngine: plan.requiredEngine },
        );
        return;
      }
      const { runnerKind, runner } = resolved;
      // Record what actually ran, so the auto-run debounce below knows whether
      // opening this node provisions something. This used to be written into the
      // user's saved *selection* — the only slot available — which is how a
      // fallback came to silently rewrite a setting the user had chosen. It is a
      // separate concern now: `node.settings.airappEngine` is what was asked for
      // (and only a person writes it), `lastEffectiveKinds` is what happened.
      store.recordEffectiveRunnerKind(currentNodeId, runnerKind);
      // The log is the honest place to report a fallback.
      engineNote = airAppEngineNote({
        runtime: plan.runtime,
        preferredEngine: plan.preferredEngine,
        userChose,
        wantedKind,
        runnerKind,
        availableEngines,
        lockedEngines: planGate?.lockedEngines,
      });
      store.beginRun(currentNodeId, runner, runnerKind, airAppFilesRevision(airapp.files));
      if (engineNote) {
        useAirAppRunnerStore.getState().appendLog(currentNodeId, runner, engineNote);
      }
      runner.onLog((chunk) =>
        useAirAppRunnerStore.getState().appendLog(currentNodeId, runner, chunk),
      );
      runner.onReady((url) =>
        useAirAppRunnerStore.getState().setPreviewUrl(currentNodeId, runner, url),
      );
      // An app that dies after it started is the case the panel used to miss
      // entirely: one log line, status frozen on "ready", and a preview that had
      // stopped answering. Surface it as the failure it is.
      runner.onExit((code) =>
        useAirAppRunnerStore
          .getState()
          .setError(
            currentNodeId,
            runner,
            code === null || code === 0
              ? messages.airapp.appStopped
              : fmt(messages.airapp.appExited, { code: String(code) }),
          ),
      );

      try {
        // Mount every file into the runner's virtual filesystem — text (utf8)
        // inline, and asset-backed binary (`encoding: "url"`, e.g. images, fonts,
        // sample data) by fetching its bytes from the asset URL the read returns.
        //
        // Binary used to be dropped here, which failed in the worst possible way:
        // the file stored fine and the pod booted fine, so an AirApp shipping its
        // own images just rendered broken `<img>`s with nothing logged anywhere.
        // A file that cannot be mounted must now say so (below) rather than
        // vanish.
        //
        // A website reads nothing here: the server reads the node's own files, because
        // what gets published must never be what a browser said it was.
        const filesToMount = resolved.runnerKind === "site" ? [] : airapp.files;
        const entries = await Promise.all(
          filesToMount.map(async (file) => {
            // Runner boot is an imperative lifecycle that can outlive this view.
            // A React Query observer for the Files tab may use the same readFile
            // key and cancel it during Strict Mode's mount cleanup, so do not join
            // that observer-owned query here.
            const detail = await orpc.fileTrees.readFile.call({
              nodeId: currentNodeId,
              filePath: file.path,
              type: "airapp",
            });
            if (detail.encoding === "utf8") {
              return [file.path, detail.content] as const;
            }
            if (!detail.assetUrl) return null;
            // Same-origin in every hosted row, so no credentials/CORS dance —
            // this is the storage URL busabase itself just handed back.
            const response = await fetch(detail.assetUrl);
            if (!response.ok) {
              throw new Error(
                `Failed to load "${file.path}" (HTTP ${response.status}) — the AirApp cannot start without it.`,
              );
            }
            return [file.path, new Uint8Array(await response.arrayBuffer())] as const;
          }),
        );
        const files: Record<string, AirAppMountedFile> = {};
        for (const fileEntry of entries) {
          if (fileEntry) {
            files[fileEntry[0]] = fileEntry[1];
          }
        }
        if (resolved.runnerKind !== "site" && Object.keys(files).length === 0) {
          throw new Error(messages.airapp.noRunnableFiles);
        }

        await runner.mount(files);
        useAirAppRunnerStore.getState().setStatus(currentNodeId, runner, "installing");
        await runner.install();
        useAirAppRunnerStore.getState().setStatus(currentNodeId, runner, "starting");
        await runner.start();
        // status flips to "ready" from the onReady callback once the dev server
        // actually reports listening — starting a process isn't the same as it
        // being reachable yet.
      } catch (caught) {
        if (caught instanceof AirAppSiteBlockedError) {
          useAirAppRunnerStore
            .getState()
            .setError(
              currentNodeId,
              runner,
              messages.airapp.site.blockedTitle,
              undefined,
              undefined,
              caught.blockers,
            );
          return;
        }
        // The server re-checks the plan on every run, so a stale page (a plan that
        // lapsed after it loaded) lands here rather than on the lock above. It is
        // the same situation and gets the same state, not a line of server text.
        const refusal = readAirAppEnginePlanRefusal(caught);
        if (refusal) {
          const lock: AirAppEngineLockState = {
            engine: refusal.engine,
            // The host's localized plan name when the dashboard has one.
            planLabel: planGate?.planLabel ?? refusal.planLabel,
          };
          useAirAppRunnerStore
            .getState()
            .setError(
              currentNodeId,
              runner,
              fmt(messages.airapp.enginePlan.lockedTitle, { plan: lock.planLabel }),
              undefined,
              lock,
            );
          return;
        }
        const accessDenied = readSiteAccessDenial(caught);
        if (accessDenied) {
          useAirAppRunnerStore
            .getState()
            .setError(
              currentNodeId,
              runner,
              siteAccessMessage(messages.airapp.site.environment, accessDenied),
              undefined,
              undefined,
              undefined,
              accessDenied,
            );
          return;
        }
        // A Service Worker failure is the one runtime error with a code: log the
        // code plus the underlying browser error for support, and show the
        // localized, phase-specific copy rather than `caught.message` (which is
        // the English log identifier).
        const swError = caught instanceof NodepodServiceWorkerError ? caught : null;
        if (swError) {
          const cause = swError.cause instanceof Error ? `: ${swError.cause.message}` : "";
          useAirAppRunnerStore
            .getState()
            .appendLog(currentNodeId, runner, `[busabase] ${swError.code}${cause}\n`);
        }
        useAirAppRunnerStore
          .getState()
          .setError(
            currentNodeId,
            runner,
            swError
              ? messages.airapp.swError[swError.code]
              : caught instanceof Error
                ? caught.message
                : messages.airapp.runFailed,
            swError?.code,
          );
      }
    },
    [messages, airapp, orpc, availableEngines, planGate],
  );

  useEffect(() => {
    if (!nodeId) return;
    const store = useAirAppRunnerStore.getState();
    const current = store.entries[nodeId];
    if (
      current !== entry ||
      current?.runnerKind !== "site" ||
      (current.status !== "error" && current.status !== "ready")
    )
      return;
    const recoverable =
      current.siteBlockers || (current.recoveringSite && current.status === "ready");
    if (!recoverable || current.filesRevision === filesRevision) {
      if (current.recoveringSite && current.runner) {
        store.finishSiteRecovery(nodeId, current.runner);
      }
      return;
    }
    // Detail uses the slug, while the side panel uses the id: their query
    // snapshots can lag each other. A stale surface must neither retry an old
    // listing nor end recovery while another surface has a newer edit pending.
    if (current.siteCheckedRevisions.includes(filesRevision)) return;
    if (!availableEngines.includes("site") || planGate?.lockedEngines.includes("site")) return;

    // Claim synchronously, before any await: detail and side-panel surfaces
    // share this entry and must not deploy the same file revision twice.
    // Stay on the website engine; an edited manifest must never start a paid
    // runtime. SiteRunner's mount/install are no-ops, so only start is needed.
    const runner = createAirAppRunner("site", { orpc, nodeId });
    store.beginRun(nodeId, runner, "site", filesRevision, true);
    runner.onLog((chunk) => useAirAppRunnerStore.getState().appendLog(nodeId, runner, chunk));
    runner.onReady((url) => useAirAppRunnerStore.getState().setPreviewUrl(nodeId, runner, url));
    void runner.start().catch((caught: unknown) => {
      const blockers = caught instanceof AirAppSiteBlockedError ? caught.blockers : undefined;
      const refusal = readAirAppEnginePlanRefusal(caught);
      const accessDenied = readSiteAccessDenial(caught);
      const lock = refusal
        ? {
            engine: refusal.engine,
            planLabel: planGate?.planLabel ?? refusal.planLabel,
          }
        : undefined;
      useAirAppRunnerStore
        .getState()
        .setError(
          nodeId,
          runner,
          blockers
            ? messages.airapp.site.blockedTitle
            : lock
              ? fmt(messages.airapp.enginePlan.lockedTitle, { plan: lock.planLabel })
              : caught instanceof Error
                ? caught.message
                : messages.airapp.runFailed,
          undefined,
          lock,
          blockers,
          accessDenied ?? undefined,
        );
    });
  }, [nodeId, filesRevision, entry, orpc, availableEngines, planGate, messages]);

  // Auto-run: opening an AirApp starts it immediately — the header button is
  // then only a restart. Reads the store directly (not the rendered `status`)
  // because two surfaces can mount this hook for the same node in one commit
  // (detail view + pinned side panel); the first run() flips the entry to
  // "loading-files" synchronously via beginRun, so the second surface sees a
  // non-idle entry and skips. Only a truly idle (never-run) node auto-starts:
  // "error" stays on screen for the user to read, "ready" keeps running.
  useEffect(() => {
    if (!nodeId || !airapp) {
      return;
    }
    const current = useAirAppRunnerStore.getState().entries[nodeId];
    if (current && current.status !== "idle") {
      return;
    }
    // Only the free engine starts on sight. For anything that provisions — a
    // host process, a remote sandbox — the node has to still be open a moment
    // later, so clicking through a list costs nothing.
    // What this node COSTS, not what was asked for. A node whose manifest pins a
    // remote engine provisions a machine even though the stored selection still
    // reads `browser` — debouncing on the selection would start one on sight,
    // for every node clicked past.
    const lastKind = useAirAppRunnerStore.getState().getEffectiveRunnerKind(nodeId);
    // A kind this space can no longer run — a remote run from before its plan
    // changed — says nothing about what opening the node costs now. If every
    // engine left is free, so is this run, and it should start on sight.
    const effective =
      availableEngines.includes(lastKind) ||
      !availableEngines.every((engine) => FREE_ENGINES.includes(engine))
        ? lastKind
        : DEFAULT_RUNNER_KIND;
    const delay = airAppAutoRunDelay(selectionsHydrated, effective);
    if (delay === null) {
      return;
    }
    if (delay === 0) {
      void run();
      return;
    }
    const timer = setTimeout(() => {
      const latest = useAirAppRunnerStore.getState().entries[nodeId];
      if (!latest || latest.status === "idle") void run();
    }, delay);
    return () => clearTimeout(timer);
  }, [nodeId, airapp, run, selectionsHydrated, availableEngines]);

  const stop = useCallback(async () => {
    if (!nodeId) return;
    const entry = useAirAppRunnerStore.getState().entries[nodeId];
    const activeRunner = entry?.runner;
    if (!activeRunner) return;
    try {
      await activeRunner.stop();
    } finally {
      // Back to idle rather than error: the user asked for this, so it is not a
      // failure to report at them. Auto-run only fires for a never-run node, so
      // this does not immediately start it again.
      useAirAppRunnerStore.getState().disposeEntry(nodeId);
    }
  }, [nodeId]);

  const isBusy = status === "loading-files" || status === "installing" || status === "starting";
  const isLive = isBusy || status === "ready";

  return {
    orpc,
    status,
    runnerKind,
    logLines,
    previewUrl,
    error,
    errorCode,
    engineLock,
    siteBlockers,
    ...(siteAccessDenied ? { siteAccessDenied } : {}),
    run,
    stop,
    isBusy,
    isLive,
  };
}

export type AirAppRunnerState = ReturnType<typeof useAirAppRunner>;

export type AirAppFullscreenState = PreviewFullscreenState;

/**
 * Owns the "maximize the preview" toggle for one AirApp surface.
 *
 * Deliberately a piece of state shared by the toolbar (which toggles it) and
 * the preview (which grows to fill the viewport) rather than a modal that
 * renders its own iframe: an iframe is reloaded by the browser whenever its
 * element is re-parented or re-created, which would throw away the running
 * app's in-page state and re-issue every request it had already made. The one
 * and only preview iframe therefore never moves — only its container's CSS
 * changes.
 */
export function useAirAppFullscreen({
  syncWithUrl = false,
}: {
  syncWithUrl?: boolean;
} = {}): AirAppFullscreenState {
  return usePreviewFullscreen({ syncWithUrl });
}

interface AirAppRunControlsProps {
  runner: AirAppRunnerState;
  airapp: AirAppVO | null;
  showPinToSidePanel?: boolean;
  showSitePublish?: boolean;
  fullscreenState: AirAppFullscreenState;
  previewState?: AirAppPreviewState;
  siteActionItems?: ReactNode;
  publishAction?: ReactNode;
  publishButton?: ReactNode;
  siteViews?: AirAppSiteViewsState;
}

/** The topbar owns Pin; both preview surfaces keep the same tab identity. */
export function AirAppPinButton({ airapp }: { airapp: AirAppVO }) {
  const messages = useCoreI18n();
  return (
    <TooltipProvider delayDuration={350}>
      <AirAppControlHint label={messages.nodeDetail.pinToSidePanel}>
        <Button
          aria-label={messages.nodeDetail.pinToSidePanel}
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() =>
            useSidePanelStore.getState().openTab({
              id: airAppSidePanelTabId(airapp.node.id),
              type: "airapp-preview",
              title: airapp.node.name,
              payload: { nodeId: airapp.node.id },
            })
          }
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Pin className="size-3.5" />
        </Button>
      </AirAppControlHint>
    </TooltipProvider>
  );
}

function AirAppControlHint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Shows the engine used by this run, independently of publication actions or saved preferences. */
function AirAppRunEngine({ runner }: { runner: AirAppRunnerState }) {
  const { airapp: messages } = useCoreI18n();
  const { runnerKind, status, engineLock } = runner;
  const names = {
    browser: messages.engineBrowser,
    local: messages.engineLocal,
    remote: messages.engineRemote,
    site: messages.engineSite,
  };
  const hints = {
    browser: messages.engineBrowserHint,
    local: messages.engineLocalHint,
    remote: messages.engineRemoteHint,
    site: messages.engineSiteHint,
  };
  const statuses: Record<AirAppRunStatus, string> = {
    idle: messages.statusIdle,
    "loading-files": messages.statusLoadingFiles,
    installing: messages.statusInstalling,
    starting: messages.statusStarting,
    ready: messages.statusReady,
    error: messages.statusError,
  };
  // Idle entries use the store's default kind, even after a different engine
  // was stopped. It is not evidence that a browser engine is running.
  const unresolved = status === "idle";
  const name = unresolved ? messages.statusIdle : names[runnerKind];
  const state = engineLock
    ? fmt(messages.enginePlan.lockedTitle, { plan: engineLock.planLabel })
    : statuses[status];
  const label = `${messages.engineLabel}: ${name}${unresolved ? "" : ` · ${state}`}`;
  const Icon = unresolved
    ? CircleStop
    : engineLock
      ? Lock
      : { browser: Monitor, local: Laptop, remote: Cloud, site: Globe }[runnerKind];
  return (
    <div
      aria-label={label}
      className="space-y-1 px-2 py-2 text-xs"
      data-airapp-engine={unresolved ? "unresolved" : runnerKind}
      role="status"
    >
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        {messages.engineLabel}: {name}
      </p>
      {unresolved ? null : (
        <>
          <p className="text-muted-foreground">{state}</p>
          <p className="text-muted-foreground">{hints[runnerKind]}</p>
        </>
      )}
    </div>
  );
}

/** A compact action cluster with a separate menu for publication and preview tools. */
export function AirAppRunControls({
  runner,
  airapp,
  showPinToSidePanel = true,
  showSitePublish = true,
  fullscreenState,
  previewState,
  siteActionItems,
  publishAction,
  publishButton,
  siteViews,
}: AirAppRunControlsProps) {
  const messages = useCoreI18n();
  const toolbarCopy = airAppToolbarMessages[useCoreLocale()];
  const availableEngines = useAirAppEngineAvailability();
  const planGate = useAirAppEnginePlanGate();
  const notConfiguredEngines = useAirAppEnginesNotConfigured();
  const permission = useWorkspacePermissionLevel();
  const isAnonymous = useIsAnonymousVisitor();
  const [releaseSettingsOpen, setReleaseSettingsOpen] = useState(false);
  const [releaseSettingsMounted, setReleaseSettingsMounted] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const canPublishSite =
    airapp &&
    !isAnonymous &&
    hasApiKeyLevel(permission, "write") &&
    (availableEngines.includes("site") ||
      planGate?.lockedEngines.includes("site") ||
      notConfiguredEngines.includes("site"));
  const {
    status,
    previewUrl,
    errorCode,
    engineLock,
    siteAccessDenied,
    run,
    stop,
    isBusy,
    isLive,
    runnerKind,
  } = runner;
  const canManageSite = canPublishSite && runnerKind === "site";
  const ownPreview = useAirAppPreviewState(previewUrl);
  const preview = siteViews?.isSite ? siteViews.activePreview : (previewState ?? ownPreview);
  const activeFrameUrl = siteViews?.isSite ? siteViews.activeFrameUrl : previewUrl;
  const isUnsupportedBrowser = errorCode === "SERVICE_WORKER_UNAVAILABLE";
  const canShareSite = Boolean(
    airapp &&
      !isAnonymous &&
      hasApiKeyLevel(permission, "write") &&
      runnerKind === "site" &&
      !engineLock,
  );
  const runLabel =
    status === "ready" || status === "error" ? messages.airapp.runAgain : messages.airapp.run;
  const stopAction =
    isLive && runnerKind !== "site" ? (
      <DropdownMenuItem onSelect={() => void stop()}>
        <CircleStop />
        {messages.airapp.stop}
      </DropdownMenuItem>
    ) : null;
  const controls = (
    siteState?: AirAppSiteStateVO,
    menuPublish: ReactNode = publishAction,
    primaryPublish: ReactNode = publishButton,
  ) => {
    const ownerUrl = absolutePreviewUrl(previewUrl, "https://preview.invalid");
    const ownerVersion = ownerUrl
      ? new URL(ownerUrl).searchParams.get("__busabase_site_version")
      : null;
    const sharedUrl =
      canShareSite && previewUrl && ownerVersion && siteState?.previewVersion === ownerVersion
        ? siteState.previewShareUrl
        : null;
    const sharingPending =
      canShareSite &&
      (status !== "ready" ||
        !siteState ||
        siteState.previewShareUrl === null ||
        (ownerVersion && siteState.previewVersion !== ownerVersion));
    const previewLink = sharingPending ? null : (sharedUrl ?? previewUrl);
    // Another actor can prepare the preview while this tab's state is stale.
    // Allow a manual recheck; preflight and the server still guard Vault uploads.
    const sitePermissionBlocked =
      Boolean(siteAccessDenied) && siteAccessDenied !== "space-vault-manage";
    return (
      <TooltipProvider delayDuration={350}>
        <div
          className="notranslate flex min-w-0 shrink-0 items-center gap-1"
          data-airapp-node-id={airapp?.node.id}
          data-airapp-run-status={status}
          data-airapp-preview-controls=""
          translate="no"
        >
          {primaryPublish}
          {status === "ready" ||
          isUnsupportedBrowser ||
          engineLock ||
          sitePermissionBlocked ? null : (
            <AirAppControlHint label={runLabel}>
              <Button
                aria-label={runLabel}
                className="h-8 w-8 gap-1.5 px-0 @min-[900px]/airapp-toolbar:w-auto @min-[900px]/airapp-toolbar:px-2.5"
                disabled={isBusy}
                onClick={() => void run(runnerKind === "site" ? { sitePreview: true } : undefined)}
                size="sm"
                type="button"
                variant="default"
              >
                {isBusy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : status === "error" ? (
                  <RotateCcw className="size-3.5" />
                ) : (
                  <Play className="size-3.5" />
                )}
                <span className="hidden @min-[900px]/airapp-toolbar:inline">{runLabel}</span>
              </Button>
            </AirAppControlHint>
          )}
          {runnerKind === "browser" ? (
            status === "ready" && !isUnsupportedBrowser && !engineLock ? (
              <AirAppControlHint label={messages.airapp.runAgain}>
                <Button
                  aria-label={messages.airapp.runAgain}
                  className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                  disabled={isBusy}
                  onClick={() => void run()}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <RotateCcw aria-hidden="true" className="size-3.5" />
                </Button>
              </AirAppControlHint>
            ) : null
          ) : (
            <AirAppControlHint
              label={
                siteViews?.isSite
                  ? toolbarCopy.refreshPage
                  : messages.airapp.site.publish.refreshPreview
              }
            >
              <Button
                aria-label={
                  siteViews?.isSite
                    ? toolbarCopy.refreshPage
                    : messages.airapp.site.publish.refreshPreview
                }
                className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                disabled={!activeFrameUrl || preview.refreshing || isBusy}
                onClick={() => {
                  // Reconcile the version and this member's proxy registration
                  // before navigating a private Site preview. Reloading its old
                  // version URL can otherwise stay on the proxy's 503 forever.
                  if (runnerKind === "site" && siteViews?.view !== "deployed")
                    void run({ sitePreview: true });
                  else preview.refresh();
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                {preview.refreshing ? (
                  <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                ) : (
                  <RotateCw aria-hidden="true" className="size-3.5" />
                )}
              </Button>
            </AirAppControlHint>
          )}
          <AirAppPreviewMenu
            compact={runnerKind === "browser" || siteViews?.isSite}
            triggerRef={menuTrigger}
            primaryAction={menuPublish}
            header={<AirAppRunEngine runner={runner} />}
            topItems={
              <>
                {runnerKind !== "browser" &&
                runnerKind !== "site" &&
                !isUnsupportedBrowser &&
                !engineLock ? (
                  <DropdownMenuItem disabled={isBusy} onSelect={() => void run()}>
                    {isBusy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                    {runLabel}
                  </DropdownMenuItem>
                ) : null}
                {activeFrameUrl && !fullscreenState.fullscreen ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      if (siteViews?.isSite) siteViews.selectView(siteViews.view);
                      fullscreenState.setFullscreen(true);
                    }}
                  >
                    <Maximize />
                    {messages.airapp.enterFullscreen}
                  </DropdownMenuItem>
                ) : null}
                {siteActionItems}
                {canManageSite ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      setReleaseSettingsMounted(true);
                      setReleaseSettingsOpen(true);
                    }}
                  >
                    <History />
                    {messages.airapp.site.releases.manage}
                  </DropdownMenuItem>
                ) : null}
              </>
            }
            extraItems={stopAction}
            kind={runnerKind}
            previewAvailable={Boolean(activeFrameUrl)}
            previewState={preview}
            showLink={!siteViews?.isSite}
            shareable={Boolean(sharedUrl)}
            url={previewLink}
          />
          {airapp && showPinToSidePanel ? <AirAppPinButton airapp={airapp} /> : null}
        </div>
      </TooltipProvider>
    );
  };
  const preparedControls = (
    menuPublish: ReactNode = publishAction,
    primaryPublish: ReactNode = publishButton,
  ) =>
    airapp && canPublishSite ? (
      <AirAppSiteGoLive
        filesRevision={airapp.files.map((file) => `${file.path}:${file.updatedAt}`).join("|")}
        nodeId={airapp.node.id}
        orpc={runner.orpc}
        renderMenuAction={(_action, state) => controls(state, menuPublish, primaryPublish)}
        runStatus={status}
      />
    ) : (
      controls(undefined, menuPublish, primaryPublish)
    );
  return (
    <>
      {airapp && showSitePublish && canPublishSite ? (
        <AirAppPublishToSite
          buttonWhenNeeded
          compact
          filesRevision={airapp.files.map((file) => `${file.path}:${file.updatedAt}`).join("|")}
          nodeId={airapp.node.id}
          nodeName={airapp.node.name}
          orpc={runner.orpc}
          placement="menu"
          publicationBusy={runner.runnerKind === "site" && runner.isBusy}
          renderButtons={(button, _releases, menuItem) => preparedControls(menuItem, button)}
          showButton
        />
      ) : (
        preparedControls()
      )}
      {airapp && canManageSite && releaseSettingsMounted ? (
        <NodeSettingsDialog
          initialTab="releases"
          nodeId={airapp.node.id}
          nodeName={airapp.node.name}
          nodeSlug={airapp.node.slug}
          nodeType="airapp"
          onCloseAutoFocus={(event) => {
            // The menuitem that opened this dialog has already unmounted.
            // Return to its durable entry point after the dialog releases focus.
            if (menuTrigger.current?.isConnected) {
              event.preventDefault();
              menuTrigger.current.focus();
            }
          }}
          onOpenChange={setReleaseSettingsOpen}
          open={releaseSettingsOpen}
          orpc={runner.orpc}
        />
      ) : null}
    </>
  );
}

interface AirAppRunPreviewProps {
  runner: AirAppRunnerState;
  /** Optional context (name/id) forwarded to `AirAppRunControls` — the
   *  preview itself only needs `runner`. */
  airapp: AirAppVO | null;
  /** The side panel has no unified header of its own, so it keeps the local
   *  toolbar row (default). The detail view hosts `AirAppRunControls` in its
   *  own compact header instead and passes `false` so the preview iframe gets
   *  every vertical pixel below it. */
  showToolbar?: boolean;
  /** Shared with the `AirAppRunControls` of the same surface. When the surface
   *  has no external toolbar (side panel), it is omitted and this component
   *  owns the state for its own toolbar. */
  fullscreenState?: AirAppFullscreenState;
  previewState?: AirAppPreviewState;
  siteViews?: AirAppSiteViewsState;
  /** Non-Site detail views own the legacy Tabs root; Sites use labeled regions. */
  tabbed?: boolean;
}

/** The preview has no reliable shape until an AirApp boots, so use an honest
 *  indeterminate state and name the runner phase instead of faking a skeleton. */
export function AirAppPreviewPending({ status }: { status: AirAppRunStatus }) {
  const messages = useCoreI18n();
  const phaseLabel: Partial<Record<AirAppRunStatus, string>> = {
    "loading-files": messages.airapp.statusLoadingFiles,
    installing: messages.airapp.statusInstalling,
    starting: messages.airapp.statusStarting,
  };

  return (
    <div className="notranslate grid h-full min-h-[160px] place-items-center p-6" translate="no">
      <div
        aria-atomic="true"
        aria-live="polite"
        className="flex max-w-xs flex-col items-center gap-3 text-center"
        data-airapp-preview-status={status}
        role="status"
      >
        <div className="relative grid size-12 place-items-center">
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-primary/10 motion-safe:animate-pulse"
          />
          <span className="relative grid size-9 place-items-center rounded-full border border-primary/20 bg-background shadow-sm">
            <Loader2 aria-hidden="true" className="size-4 text-primary motion-safe:animate-spin" />
          </span>
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground text-sm">
            {phaseLabel[status] ?? messages.airapp.previewPending}
          </p>
          <p className="text-muted-foreground text-xs">{messages.airapp.previewPending}</p>
        </div>
      </div>
    </div>
  );
}

export function AirAppRunError({ error }: { error: string }) {
  return (
    <div
      className="notranslate border-border/60 border-b bg-destructive/5 px-4 py-2 text-destructive text-xs"
      translate="no"
    >
      {error}
    </div>
  );
}

/**
 * Dedicated recovery state for `SERVICE_WORKER_UNAVAILABLE` — e.g. iOS in-app
 * browsers (WeCom, and other WKWebView-based hosts) that expose no
 * `navigator.serviceWorker` at all. Nodepod cannot run without a controlling
 * Service Worker there, and no in-app retry or fix is possible: unlike the
 * other `swError` codes (registration/activation/control timeouts, which are
 * transient and recover with "run again"), this one is a hard capability gap
 * that only the system browser can cross. So it replaces the generic dead-end
 * banner with actionable guidance instead of leaving the user stuck.
 *
 * Copy-link, not a forced redirect: no in-app browser can be reliably driven
 * to open Safari/Chrome from pure JS, but `window.location.href` at the
 * moment of failure is always the exact page the user was trying to reach —
 * copying it is the one action that reliably survives the hop to a real
 * browser on iOS.
 */
export function AirAppServiceWorkerUnsupported() {
  const messages = useCoreI18n();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const currentUrl = typeof window === "undefined" ? "" : window.location.href;

  useEffect(() => {
    if (!copyFailed) return;
    linkInputRef.current?.focus();
    linkInputRef.current?.select();
  }, [copyFailed]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopyFailed(false);
      setCopied(true);
      toast.success(messages.airapp.swUnsupportedLinkCopied);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be blocked inside an in-app browser. Fall back to
      // a selectable input so the user can still copy the link by hand.
      setCopyFailed(true);
    }
  }, [currentUrl, messages.airapp.swUnsupportedLinkCopied]);

  return (
    <div
      aria-live="polite"
      className="notranslate grid h-full min-h-[160px] place-items-center p-6"
      data-airapp-sw-unsupported=""
      role="alert"
      translate="no"
    >
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <p className="font-medium text-foreground text-sm">{messages.airapp.swUnsupportedTitle}</p>
        <p className="text-muted-foreground text-xs">{messages.airapp.swUnsupportedBody}</p>
        <Button className="gap-1.5" onClick={() => void handleCopyLink()} size="sm" type="button">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {messages.airapp.swUnsupportedCopyLink}
        </Button>
        {copyFailed ? (
          <div className="flex w-full flex-col items-center gap-1">
            <p className="text-muted-foreground text-xs">
              {messages.airapp.swUnsupportedCopyFailed}
            </p>
            <input
              aria-label={messages.airapp.swUnsupportedCopyLink}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-center text-foreground text-xs"
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              ref={linkInputRef}
              value={currentUrl}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The app cannot start because the engine it needs is outside this space's
 * plan — a Python app, or one whose `airapp.json` requires `remote`, in a space
 * whose plan does not include remote machines.
 *
 * Deliberately not the generic "this deployment can't run this app": that
 * sentence is false here, and it leaves the person with nothing to do. The app
 * WOULD run after an upgrade, so this names the plan and, when the host
 * provides one, offers the upgrade itself. The plan name and the action both
 * come from the host — core has no idea what anybody's plans are called.
 */
export function AirAppEnginePlanLocked({ lock }: { lock: AirAppEngineLockState }) {
  const messages = useCoreI18n();
  const planGate = useAirAppEnginePlanGate();
  const engineLabel: Record<AirAppRunnerKind, string> = {
    browser: messages.airapp.engineBrowser,
    local: messages.airapp.engineLocal,
    remote: messages.airapp.engineRemote,
    site: messages.airapp.engineSite,
  };
  const onUpgrade = planGate?.onUpgrade;

  return (
    <div
      aria-live="polite"
      className="notranslate grid h-full min-h-[160px] place-items-center p-6"
      data-airapp-engine-locked={lock.engine}
      role="status"
      translate="no"
    >
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <span className="grid size-9 place-items-center rounded-full border border-border bg-muted text-muted-foreground">
          <Lock aria-hidden="true" className="size-4" />
        </span>
        <p className="font-medium text-foreground text-sm">
          {fmt(messages.airapp.enginePlan.lockedTitle, { plan: lock.planLabel })}
        </p>
        <p className="text-muted-foreground text-xs">
          {fmt(messages.airapp.enginePlan.lockedBody, { engine: engineLabel[lock.engine] })}
        </p>
        {onUpgrade ? (
          <Button className="gap-1.5" onClick={onUpgrade} size="sm" type="button">
            <ArrowUpCircle className="size-3.5" />
            {fmt(messages.airapp.enginePlan.upgrade, { plan: lock.planLabel })}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Running application content, optionally topped by a local toolbar.
 *  Sites keep private/public modes in persistent, labeled regions.
 *
 *  Going fullscreen only swaps this container's classes — the iframe element
 *  underneath is never re-created or re-parented, so the running app keeps its
 *  DOM, JS memory and already-fetched data instead of booting again. */
export function AirAppRunPreview(props: AirAppRunPreviewProps) {
  if (props.airapp && props.runner.runnerKind === "site" && !props.siteViews) {
    return <AirAppSiteRunPreview {...props} />;
  }
  return <AirAppRunPreviewSurface {...props} />;
}

function AirAppSiteRunPreview(props: AirAppRunPreviewProps) {
  const siteViews = useAirAppSiteViews({
    orpc: props.runner.orpc,
    airapp: props.airapp,
    kind: props.runner.runnerKind,
    previewUrl: props.runner.previewUrl,
    status: props.runner.status,
  });
  return <AirAppRunPreviewSurface {...props} siteViews={siteViews} />;
}

function AirAppRunPreviewSurface({
  runner,
  airapp,
  showToolbar = true,
  fullscreenState,
  previewState,
  siteViews,
  tabbed = false,
}: AirAppRunPreviewProps) {
  const messages = useCoreI18n();
  const toolbarCopy = airAppToolbarMessages[useCoreLocale()];
  const { status, previewUrl, error, errorCode, engineLock, siteBlockers, siteAccessDenied } =
    runner;
  const ownFullscreen = useAirAppFullscreen();
  const activeFullscreen = fullscreenState ?? ownFullscreen;
  const ownPreview = useAirAppPreviewState(previewUrl);
  const isSite = Boolean(siteViews?.isSite);
  const preview = isSite && siteViews ? siteViews.preview : (previewState ?? ownPreview);
  const activePreview = isSite && siteViews ? siteViews.activePreview : preview;
  const logsPanelId = useId();
  const browserLogs = useAirAppBrowserLogs({
    frameRef: preview.frameRef,
    url: isSite ? previewUrl : null,
  });
  const isUnsupportedBrowser = errorCode === "SERVICE_WORKER_UNAVAILABLE";
  const draft = (
    <AirAppPreviewViewport
      fallback={
        isUnsupportedBrowser ? (
          <AirAppServiceWorkerUnsupported />
        ) : engineLock ? (
          <AirAppEnginePlanLocked lock={engineLock} />
        ) : siteAccessDenied ? (
          <div
            className="grid h-full min-h-[160px] place-items-center p-6 text-center text-muted-foreground text-sm"
            data-airapp-site-access-denied=""
            role="alert"
          >
            {siteAccessMessage(messages.airapp.site.environment, siteAccessDenied)}
          </div>
        ) : siteBlockers ? (
          <AirAppSiteBlockers blockers={siteBlockers} />
        ) : status === "idle" || status === "error" ? (
          <div
            className="notranslate grid h-full min-h-[160px] place-items-center p-6 text-center text-muted-foreground text-sm"
            translate="no"
          >
            {status === "idle" ? messages.airapp.previewEmpty : messages.airapp.previewFailed}
          </div>
        ) : (
          <AirAppPreviewPending status={status} />
        )
      }
      onError={preview.loaded}
      onLoad={preview.loaded}
      ref={preview.frameRef}
      src={
        isUnsupportedBrowser || engineLock || siteBlockers || siteAccessDenied ? null : previewUrl
      }
      title={messages.airapp.previewTitle}
      wrapFrame={(frame) => (
        <AirAppPreviewFrame viewport={preview.viewport}>{frame}</AirAppPreviewFrame>
      )}
    />
  );
  const panelClass =
    "mt-0 flex min-h-0 min-w-0 flex-1 flex-col data-[state=inactive]:hidden data-[state=inactive]:pointer-events-none";
  const surface = (
    <FullscreenPreviewSurface
      aria-label={airapp?.node.name ?? messages.airapp.previewTitle}
      bodyClassName="flex flex-col"
      banner={
        error && !isUnsupportedBrowser && !engineLock && !siteBlockers && !siteAccessDenied ? (
          <AirAppRunError error={error} />
        ) : null
      }
      data-airapp-fullscreen={activeFullscreen.fullscreen ? "true" : "false"}
      data-airapp-preview=""
      exitLabel={messages.airapp.exitFullscreen}
      fullscreenState={activeFullscreen}
      toolbar={
        showToolbar ? (
          <div
            className={`@container/airapp-toolbar flex min-h-11 min-w-0 items-center justify-end gap-1 border-border/60 border-b px-3 py-2 ${isSite ? "flex-nowrap" : "flex-wrap"}`}
            data-airapp-run-toolbar=""
          >
            {isSite && siteViews ? (
              <div className="flex shrink-0 items-center gap-1" data-airapp-view-switcher="">
                <AirAppSiteModeSwitch views={siteViews} />
                <AirAppSiteContextActions views={siteViews} />
              </div>
            ) : null}
            {isSite && siteViews ? (
              <AirAppSiteToolbarActions
                views={siteViews}
                controls={
                  <AirAppRunControls
                    airapp={airapp}
                    fullscreenState={activeFullscreen}
                    runner={runner}
                    showPinToSidePanel={false}
                    previewState={activePreview}
                    siteViews={siteViews}
                  />
                }
              />
            ) : (
              <AirAppRunControls
                airapp={airapp}
                fullscreenState={activeFullscreen}
                runner={runner}
                showPinToSidePanel={false}
                previewState={activePreview}
              />
            )}
          </div>
        ) : null
      }
    >
      {isSite && siteViews ? (
        <>
          <section
            aria-label={toolbarCopy.menuShort}
            className={
              siteViews.view === "preview" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"
            }
            data-airapp-site-view="preview"
            hidden={siteViews.view !== "preview"}
          >
            {isSite && siteViews ? (
              <>
                <div
                  className={
                    siteViews.panel === "content" ? "flex min-h-0 flex-1 flex-col" : "hidden"
                  }
                >
                  {draft}
                </div>
                {siteViews.panel === "files" && airapp ? (
                  <AirAppFilesPanel airapp={airapp} orpc={runner.orpc} />
                ) : null}
                {siteViews.panel === "logs" ? (
                  <AirAppRunLogs runner={{ ...runner, logLines: browserLogs.lines }} />
                ) : null}
              </>
            ) : (
              draft
            )}
          </section>
          <section
            aria-label={toolbarCopy.deployedSite}
            className={
              siteViews.view === "deployed" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"
            }
            data-airapp-site-view="deployed"
            hidden={siteViews.view !== "deployed"}
          >
            <div
              className={siteViews.panel === "content" ? "flex min-h-0 flex-1 flex-col" : "hidden"}
            >
              <AirAppPreviewViewport
                credentialless
                data-airapp-deployed-frame=""
                frameKey={siteViews.deployedVersion ?? undefined}
                onError={siteViews.deployed.loaded}
                onLoad={siteViews.deployed.loaded}
                ref={siteViews.deployed.frameRef}
                src={siteViews.deployedVisited ? siteViews.deployedUrl : null}
                title={toolbarCopy.deployedSite}
                wrapFrame={(frame) => (
                  <AirAppPreviewFrame viewport={siteViews.deployed.viewport}>
                    {frame}
                  </AirAppPreviewFrame>
                )}
              />
            </div>
            {siteViews.view === "deployed" &&
            siteViews.panel === "logs" &&
            siteViews.deployedVersion &&
            airapp ? (
              <div className="min-h-0 min-w-0 flex-1 overflow-auto p-3">
                <AirAppSiteLogs
                  nodeId={airapp.node.id}
                  orpc={runner.orpc}
                  version={siteViews.deployedVersion}
                  versionLabel={siteViews.deployedVersion.slice(0, 8)}
                  id={logsPanelId}
                  onClose={() => siteViews.togglePanel("logs")}
                />
              </div>
            ) : null}
          </section>
        </>
      ) : tabbed ? (
        <TabsContent className={panelClass} forceMount value="app">
          {draft}
        </TabsContent>
      ) : (
        draft
      )}
    </FullscreenPreviewSurface>
  );
  return isSite && showToolbar ? (
    <div className="@container/airapp-toolbar flex min-h-0 min-w-0 flex-1 flex-col">{surface}</div>
  ) : (
    surface
  );
}

/** "Logs" tab content: the streaming install/start log console. No local
 *  title row — the "Logs" tab trigger in the detail-view header already names
 *  this surface, so the console gets the full panel height. */
export function AirAppRunLogs({ runner }: { runner: AirAppRunnerState }) {
  const messages = useCoreI18n();
  const logRef = useRef<HTMLPreElement | null>(null);
  const { logLines } = runner;
  const logText = useMemo(() => renderTerminalOutput(logLines.join("")), [logLines]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll-to-bottom on every new log line
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <pre
        className="notranslate min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-muted/20 p-3 font-mono text-[11px] text-foreground/80 leading-5"
        ref={logRef}
        translate="no"
      >
        {logLines.length === 0 ? messages.airapp.logsEmpty : logText}
      </pre>
    </div>
  );
}

/**
 * Side-panel tab renderer for an airapp's live preview (registered as
 * `"airapp-preview"` in `dashboard/components/node-detail-views.tsx`).
 * Fetches the same airapp record `AirAppDetailView` fetches; because the run
 * state (`useAirAppRunnerStore`) is keyed by node id, this instance
 * automatically shares the same live run state as the main detail view for
 * the same node — no extra wiring needed.
 */
export function AirAppSidePanelPreview({ orpc, payload }: SidePanelTabProps) {
  const messages = useCoreI18n();
  const { nodeId } = payload as { nodeId: string };

  const airappQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId, type: "airapp" } }),
    enabled: Boolean(nodeId),
  });
  // `nodes.get` is one route for every node type, so narrow to the AirApp branch.
  const airapp = asNodeDetail(airappQuery.isError ? undefined : airappQuery.data, "airapp");
  const runner = useAirAppRunner({ orpc, airapp });

  if (!airapp) {
    return airappQuery.isLoading ? (
      <NodeDetailSkeleton variant="skill" />
    ) : (
      <EmptyState
        body={fmt(messages.nodeDetail.airappNotFoundBody, { slug: nodeId })}
        title={messages.nodeDetail.airappNotFoundTitle}
      />
    );
  }

  return <AirAppRunPreview airapp={airapp} runner={runner} />;
}
