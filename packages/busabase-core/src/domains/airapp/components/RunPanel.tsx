"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AirAppVO } from "busabase-contract/types";
import { Button } from "kui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "kui/select";
import { CircleStop, Loader2, Maximize, Minimize, Pin, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { fmt, useCoreI18n } from "../../../i18n";
import { EmptyState } from "../../dashboard/components/primitives";
import { NodeDetailSkeleton } from "../../dashboard/components/skeletons";
import { asNodeDetail } from "../../dashboard/helpers/node-detail";
import type { SidePanelTabProps } from "../../dashboard/side-panel-registry";
import { useSidePanelStore } from "../../dashboard/store/side-panel-store";
import { airAppSidePanelTabId } from "../store/airapp-keepalive-store";
import {
  type AirAppRunStatus,
  IDLE_ENTRY,
  useAirAppRunnerStore,
} from "../store/airapp-runner-store";
import {
  AIRAPP_MANIFEST_PATH,
  resolveEngine,
  resolveRunPlan,
} from "../utils/airapp-runtime-descriptor";
import { isAirAppFullscreenSearch, updateAirAppFullscreenSearch } from "../utils/fullscreen-query";
import { NodepodServiceWorkerError } from "../utils/nodepod-service-worker";
import { AIRAPP_PREVIEW_IFRAME_SANDBOX } from "../utils/preview-sandbox";
import { useAirAppEngineAvailability } from "./engine-availability-context";
import { createAirAppRunner } from "./runners/runner-factory";
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

  const selectEntry = useCallback(
    (state: ReturnType<typeof useAirAppRunnerStore.getState>) =>
      nodeId ? (state.entries[nodeId] ?? IDLE_ENTRY) : IDLE_ENTRY,
    [nodeId],
  );
  const entry = useAirAppRunnerStore(selectEntry);
  const { status, logLines, previewUrl, error } = entry;
  const selectedRunnerKind = useAirAppRunnerStore((state) =>
    nodeId ? (state.selectedKinds[nodeId] ?? "browser") : "browser",
  );
  const availableEngines = useAirAppEngineAvailability();
  const setRunnerKind = useCallback(
    (kind: AirAppRunnerKind) => {
      if (nodeId) {
        useAirAppRunnerStore.getState().selectRunnerKind(nodeId, kind);
      }
    },
    [nodeId],
  );

  const run = useCallback(async () => {
    if (!airapp) {
      return;
    }
    const currentNodeId = airapp.node.id;
    const store = useAirAppRunnerStore.getState();
    const wantedKind = store.getSelectedRunnerKind(currentNodeId);

    // Which engine can actually run this app has to be settled BEFORE the
    // runner is constructed — and the answer lives in the app's own files. The
    // alternative (construct the stored default, then discover the mismatch
    // during install) is what would make opening a Python AirApp auto-start it
    // in the browser, a JavaScript-only runtime, and fail every single time.
    //
    // Only the manifest needs to be fetched: runtime inference keys off which
    // marker files exist, which the listing already tells us.
    let runnerKind = wantedKind;
    let engineNote: string | null = null;
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
      const plan = resolveRunPlan(probeFiles);
      // The app's own preference outranks a stale per-tab selection, but only
      // as a preference: an app pinning an engine this deployment lacks still
      // runs on whatever else is eligible instead of becoming unrunnable.
      // An app's own preference is honoured only if this deployment actually
      // has that engine. A pin the host cannot satisfy must not make the app
      // unrunnable — it falls back to whatever else is eligible.
      const preferred = plan.preferredEngine ?? wantedKind;
      const resolved = resolveEngine(plan.runtime, preferred, availableEngines);
      if (!resolved) {
        useAirAppRunnerStore
          .getState()
          .failBeforeRun(
            currentNodeId,
            wantedKind,
            fmt(messages.airapp.noEligibleEngine, { runtime: plan.runtime }),
          );
        return;
      }
      if (resolved !== wantedKind) {
        engineNote = `[busabase] engine "${resolved}" selected for runtime "${plan.runtime}"\n`;
        // Write the derived engine back to the selection, so the picker names
        // the engine that is actually running. Leaving it alone showed
        // "In browser" beside a Python app running on the host — the toolbar
        // contradicting the logs, with the logs being right.
        store.selectRunnerKind(currentNodeId, resolved);
      }
      runnerKind = resolved;
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

    const runner = createAirAppRunner(runnerKind, { orpc, nodeId: currentNodeId });
    store.beginRun(currentNodeId, runner, runnerKind);
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
      const entries = await Promise.all(
        airapp.files.map(async (file) => {
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
      if (Object.keys(files).length === 0) {
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
        );
    }
  }, [messages, airapp, orpc, availableEngines]);

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
    const selected = useAirAppRunnerStore.getState().getSelectedRunnerKind(nodeId);
    if (FREE_ENGINES.includes(selected)) {
      void run();
      return;
    }
    const timer = setTimeout(() => {
      const latest = useAirAppRunnerStore.getState().entries[nodeId];
      if (!latest || latest.status === "idle") void run();
    }, REMOTE_AUTO_RUN_DWELL_MS);
    return () => clearTimeout(timer);
  }, [nodeId, airapp, run]);

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
    status,
    logLines,
    previewUrl,
    error,
    run,
    stop,
    isBusy,
    isLive,
    runnerKind: selectedRunnerKind,
    setRunnerKind,
  };
}

export type AirAppRunnerState = ReturnType<typeof useAirAppRunner>;

export interface AirAppFullscreenState {
  fullscreen: boolean;
  setFullscreen: (fullscreen: boolean) => void;
}

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
  const [localFullscreen, setLocalFullscreen] = useState(false);
  const [location, setLocation] = useLocation();
  const currentSearch = useSearch();
  const fullscreen = syncWithUrl ? isAirAppFullscreenSearch(currentSearch) : localFullscreen;

  const setFullscreen = useCallback(
    (nextFullscreen: boolean) => {
      if (!syncWithUrl) {
        setLocalFullscreen(nextFullscreen);
        return;
      }

      const nextSearch = updateAirAppFullscreenSearch(currentSearch, nextFullscreen);
      setLocation(nextSearch ? `${location}?${nextSearch}` : location, { replace: true });
    },
    [currentSearch, location, setLocation, syncWithUrl],
  );

  useEffect(() => {
    if (!fullscreen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFullscreen(false);
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", exitOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", exitOnEscape);
    };
  }, [fullscreen, setFullscreen]);

  return { fullscreen, setFullscreen };
}

interface AirAppRunControlsProps {
  runner: AirAppRunnerState;
  /** Optional context (name/id) used by the "pin to side panel" and
   *  fullscreen actions — the run/status controls only need `runner`. */
  airapp: AirAppVO | null;
  showPinToSidePanel?: boolean;
  /** Fullscreen state shared with the `AirAppRunPreview` of the same surface,
   *  so the toggle grows the existing preview instead of opening a second one. */
  fullscreenState: AirAppFullscreenState;
}

/** The run control cluster shared by the AirApp detail-view header and the
 *  side-panel toolbar. Fullscreen is a viewport surface rather than a modal:
 *  the already-running preview grows to fill the browser and a floating
 *  restore button returns it to the exact surface it came from (detail view
 *  or side panel). */
export function AirAppRunControls({
  runner,
  airapp,
  showPinToSidePanel = true,
  fullscreenState,
}: AirAppRunControlsProps) {
  const messages = useCoreI18n();
  const availableEngines = useAirAppEngineAvailability();
  const { status, previewUrl, run, stop, isBusy, isLive, runnerKind, setRunnerKind } = runner;
  const { fullscreen, setFullscreen } = fullscreenState;

  const statusLabel: Record<AirAppRunStatus, string> = {
    idle: messages.airapp.statusIdle,
    "loading-files": messages.airapp.statusLoadingFiles,
    installing: messages.airapp.statusInstalling,
    starting: messages.airapp.statusStarting,
    ready: messages.airapp.statusReady,
    error: messages.airapp.statusError,
  };

  const engineLabel: Record<AirAppRunnerKind, string> = {
    browser: messages.airapp.engineBrowser,
    local: messages.airapp.engineLocal,
    remote: messages.airapp.engineRemote,
  };

  const engineHint: Record<AirAppRunnerKind, string> = {
    browser: messages.airapp.engineBrowserHint,
    local: messages.airapp.engineLocalHint,
    remote: messages.airapp.engineRemoteHint,
  };

  const pinToSidePanel = () => {
    if (!airapp) {
      return;
    }
    useSidePanelStore.getState().openTab({
      id: airAppSidePanelTabId(airapp.node.id),
      type: "airapp-preview",
      title: airapp.node.name,
      payload: { nodeId: airapp.node.id },
    });
  };

  return (
    <div
      className="flex items-center gap-1.5"
      data-airapp-node-id={airapp?.node.id}
      data-airapp-run-status={status}
    >
      <span className="hidden text-muted-foreground/70 text-xs sm:inline">
        {statusLabel[status]}
      </span>
      {/* Shown only where there is a choice to make. A deployment that offers
       *  one engine renders no picker at all — which is every cloud deployment
       *  with no remote provider configured, and was the basis of an earlier
       *  comment here claiming this "compiles out in production". It does not:
       *  there is no build-time gate, and the single-user build (which offers
       *  `browser` + `local`) does show this control to end users. */}
      {availableEngines.length > 1 ? (
        <>
          <Select
            disabled={isBusy}
            onValueChange={(value) => setRunnerKind(value as AirAppRunnerKind)}
            value={runnerKind}
          >
            <SelectTrigger
              aria-label={messages.airapp.engineLabel}
              className="h-7 w-auto min-w-0 gap-1 px-2 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableEngines.map((engine) => (
                <SelectItem key={engine} value={engine}>
                  {engineLabel[engine]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="hidden text-muted-foreground/70 text-xs 2xl:inline">
            {engineHint[runnerKind]}
          </span>
        </>
      ) : null}
      {airapp && showPinToSidePanel ? (
        <Button
          aria-label={messages.nodeDetail.pinToSidePanel}
          onClick={pinToSidePanel}
          size="icon-sm"
          title={messages.nodeDetail.pinToSidePanel}
          type="button"
          variant="outline"
        >
          <Pin className="size-3.5" />
        </Button>
      ) : null}
      {previewUrl && !fullscreen ? (
        <Button
          aria-label={messages.airapp.enterFullscreen}
          onClick={() => setFullscreen(true)}
          size="icon-sm"
          title={messages.airapp.enterFullscreen}
          type="button"
          variant="outline"
        >
          <Maximize className="size-3.5" />
        </Button>
      ) : null}
      {isLive ? (
        <Button
          aria-label={messages.airapp.stop}
          onClick={() => void stop()}
          size="icon-sm"
          title={messages.airapp.stopHint}
          type="button"
          variant="outline"
        >
          <CircleStop className="size-3.5" />
        </Button>
      ) : null}
      <Button
        disabled={isBusy}
        onClick={() => void run()}
        size="sm"
        type="button"
        variant={status === "ready" ? "outline" : "default"}
      >
        {isBusy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : status === "ready" || status === "error" ? (
          <RotateCcw className="size-3.5" />
        ) : (
          <Play className="size-3.5" />
        )}
        {status === "ready" || status === "error" ? messages.airapp.runAgain : messages.airapp.run}
      </Button>
    </div>
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
    <div className="grid h-full min-h-[160px] place-items-center p-6">
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

/** "App" tab content: the live preview iframe, optionally topped by a local
 *  run toolbar (see `showToolbar`).
 *
 *  Going fullscreen only swaps this container's classes — the iframe element
 *  underneath is never re-created or re-parented, so the running app keeps its
 *  DOM, JS memory and already-fetched data instead of booting again. */
export function AirAppRunPreview({
  runner,
  airapp,
  showToolbar = true,
  fullscreenState,
}: AirAppRunPreviewProps) {
  const messages = useCoreI18n();
  const { status, previewUrl, error } = runner;
  const ownFullscreen = useAirAppFullscreen();
  const activeFullscreen = fullscreenState ?? ownFullscreen;
  const { fullscreen, setFullscreen } = activeFullscreen;

  return (
    <section
      aria-label={airapp?.node.name ?? messages.airapp.previewTitle}
      className={
        fullscreen
          ? "fixed inset-0 z-[100] flex h-full min-h-0 flex-col bg-background"
          : "flex h-full min-h-0 flex-col"
      }
      data-airapp-fullscreen={fullscreen ? "true" : "false"}
      data-airapp-preview=""
    >
      {showToolbar ? (
        <div className="flex min-h-11 items-center justify-between gap-2 border-border/60 border-b px-4 py-2">
          <span className="font-medium text-muted-foreground text-xs uppercase">
            {messages.airapp.runPanelTitle}
          </span>
          <AirAppRunControls
            airapp={airapp}
            fullscreenState={activeFullscreen}
            runner={runner}
            showPinToSidePanel={false}
          />
        </div>
      ) : null}

      {error ? (
        <div className="border-border/60 border-b bg-destructive/5 px-4 py-2 text-destructive text-xs">
          {error}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        {previewUrl && fullscreen ? (
          <Button
            aria-label={messages.airapp.exitFullscreen}
            className="absolute top-3 right-3 z-10 bg-background/90 shadow-lg backdrop-blur-sm"
            onClick={() => setFullscreen(false)}
            size="icon"
            title={messages.airapp.exitFullscreen}
            type="button"
            variant="outline"
          >
            <Minimize className="size-4" />
          </Button>
        ) : null}
        {previewUrl ? (
          <iframe
            className="h-full w-full border-0 bg-white"
            sandbox={AIRAPP_PREVIEW_IFRAME_SANDBOX}
            src={previewUrl}
            title={messages.airapp.previewTitle}
          />
        ) : status === "idle" || status === "error" ? (
          <div className="grid h-full min-h-[160px] place-items-center p-6 text-center text-muted-foreground text-sm">
            {status === "idle" ? messages.airapp.previewEmpty : messages.airapp.previewFailed}
          </div>
        ) : (
          <AirAppPreviewPending status={status} />
        )}
      </div>
    </section>
  );
}

/** "Logs" tab content: the streaming install/start log console. No local
 *  title row — the "Logs" tab trigger in the detail-view header already names
 *  this surface, so the console gets the full panel height. */
export function AirAppRunLogs({ runner }: { runner: AirAppRunnerState }) {
  const messages = useCoreI18n();
  const logRef = useRef<HTMLPreElement | null>(null);
  const { logLines } = runner;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll-to-bottom on every new log line
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <pre
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-muted/20 p-3 font-mono text-[11px] text-foreground/80 leading-5"
        ref={logRef}
      >
        {logLines.length === 0 ? messages.airapp.logsEmpty : logLines.join("")}
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
  const airapp = asNodeDetail(airappQuery.data, "airapp");
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
