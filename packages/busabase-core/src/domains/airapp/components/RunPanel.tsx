"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AirAppVO } from "busabase-contract/types";
import { Button } from "kui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "kui/select";
import { Loader2, Maximize, Minimize, Pin, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useSearch } from "wouter";
import { fmt, useCoreI18n } from "../../../i18n";
import { EmptyState } from "../../dashboard/components/primitives";
import { NodeDetailSkeleton } from "../../dashboard/components/skeletons";
import type { SidePanelTabProps } from "../../dashboard/side-panel-registry";
import { useSidePanelStore } from "../../dashboard/store/side-panel-store";
import { airAppSidePanelTabId } from "../store/airapp-keepalive-store";
import {
  type AirAppRunStatus,
  IDLE_ENTRY,
  useAirAppRunnerStore,
} from "../store/airapp-runner-store";
import { isAirAppFullscreenSearch, updateAirAppFullscreenSearch } from "../utils/fullscreen-query";
import { createAirAppRunner } from "./runners/runner-factory";
import type { AirAppRunnerKind } from "./runners/types";

/**
 * Owns the Nodepod runner lifecycle (mount/install/start, log streaming,
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
    nodeId ? (state.selectedKinds[nodeId] ?? "nodepod") : "nodepod",
  );
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
    const runnerKind = store.getSelectedRunnerKind(currentNodeId);

    const runner = createAirAppRunner(runnerKind, { orpc, nodeId: currentNodeId });
    store.beginRun(currentNodeId, runner, runnerKind);
    runner.onLog((chunk) =>
      useAirAppRunnerStore.getState().appendLog(currentNodeId, runner, chunk),
    );
    runner.onReady((url) =>
      useAirAppRunnerStore.getState().setPreviewUrl(currentNodeId, runner, url),
    );

    try {
      // Mount every text (utf8) file into the runner's virtual filesystem;
      // asset-backed binary files (`encoding: "url"`, e.g. images) are skipped
      // for V1 — Nodepod's virtual fs takes `Uint8Array` too, so binary mounting
      // is a straightforward follow-up, not a hard limitation.
      const entries = await Promise.all(
        airapp.files.map(async (file) => {
          // Runner boot is an imperative lifecycle that can outlive this view.
          // A React Query observer for the Files tab may use the same readFile
          // key and cancel it during Strict Mode's mount cleanup, so do not join
          // that observer-owned query here.
          const detail = await orpc.airapps.readFile.call({
            nodeId: currentNodeId,
            filePath: file.path,
          });
          return detail.encoding === "utf8" ? ([file.path, detail.content] as const) : null;
        }),
      );
      const files: Record<string, string> = {};
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
      useAirAppRunnerStore
        .getState()
        .setError(
          currentNodeId,
          runner,
          caught instanceof Error ? caught.message : messages.airapp.runFailed,
        );
    }
  }, [messages, airapp, orpc]);

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
    if (!current || current.status === "idle") {
      void run();
    }
  }, [nodeId, airapp, run]);

  const isBusy = status === "loading-files" || status === "installing" || status === "starting";

  return {
    status,
    logLines,
    previewUrl,
    error,
    run,
    isBusy,
    runnerKind: selectedRunnerKind,
    setRunnerKind,
  };
}

export type AirAppRunnerState = ReturnType<typeof useAirAppRunner>;

interface AirAppRunControlsProps {
  runner: AirAppRunnerState;
  /** Optional context (name/id) used by the "pin to side panel" and
   *  fullscreen actions — the run/status controls only need `runner`. */
  airapp: AirAppVO | null;
  showPinToSidePanel?: boolean;
  syncFullscreenWithUrl?: boolean;
}

/** The run control cluster shared by the AirApp detail-view header and the
 *  side-panel toolbar. Fullscreen is a viewport surface rather than a modal:
 *  the preview fills the browser and a floating restore button returns to the
 *  exact surface it came from (detail view or side panel). */
export function AirAppRunControls({
  runner,
  airapp,
  showPinToSidePanel = true,
  syncFullscreenWithUrl = false,
}: AirAppRunControlsProps) {
  const messages = useCoreI18n();
  const { status, previewUrl, run, isBusy, runnerKind, setRunnerKind } = runner;
  const [localFullscreen, setLocalFullscreen] = useState(false);
  const [location, setLocation] = useLocation();
  const currentSearch = useSearch();
  const fullscreen = syncFullscreenWithUrl
    ? isAirAppFullscreenSearch(currentSearch)
    : localFullscreen;
  const setFullscreen = useCallback(
    (nextFullscreen: boolean) => {
      if (!syncFullscreenWithUrl) {
        setLocalFullscreen(nextFullscreen);
        return;
      }

      const nextSearch = updateAirAppFullscreenSearch(currentSearch, nextFullscreen);
      setLocation(nextSearch ? `${location}?${nextSearch}` : location, { replace: true });
    },
    [currentSearch, location, setLocation, syncFullscreenWithUrl],
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

  const statusLabel: Record<AirAppRunStatus, string> = {
    idle: messages.airapp.statusIdle,
    "loading-files": messages.airapp.statusLoadingFiles,
    installing: messages.airapp.statusInstalling,
    starting: messages.airapp.statusStarting,
    ready: messages.airapp.statusReady,
    error: messages.airapp.statusError,
  };

  const engineHint: Record<AirAppRunnerKind, string> = {
    nodepod: messages.airapp.engineNodepodHint,
    "local-node": messages.airapp.engineLocalNodeHint,
    srt: messages.airapp.engineSrtHint,
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
    <div className="flex items-center gap-1.5">
      <span className="hidden text-muted-foreground/70 text-xs sm:inline">
        {statusLabel[status]}
      </span>
      {/* Engine picker is a dev-only affordance: in a production build this
       *  compiles out entirely, so end users never see it and always get the
       *  default engine ("nodepod"). */}
      {process.env.NODE_ENV === "development" ? (
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
              <SelectItem value="nodepod">{messages.airapp.engineNodepod}</SelectItem>
              <SelectItem value="local-node">{messages.airapp.engineLocalNode}</SelectItem>
              <SelectItem value="srt">{messages.airapp.engineSrt}</SelectItem>
            </SelectContent>
          </Select>
          <span className="hidden text-muted-foreground/70 text-xs 2xl:inline">
            {engineHint[runnerKind]}
          </span>
        </>
      ) : null}
      {airapp && showPinToSidePanel ? (
        <Button
          aria-label={messages.airapp.pinToSidePanel}
          onClick={pinToSidePanel}
          size="icon-sm"
          title={messages.airapp.pinToSidePanel}
          type="button"
          variant="outline"
        >
          <Pin className="size-3.5" />
        </Button>
      ) : null}
      {previewUrl ? (
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
      {previewUrl && fullscreen && typeof document !== "undefined"
        ? createPortal(
            <section
              aria-label={airapp?.node.name ?? messages.airapp.previewTitle}
              className="fixed inset-0 z-[100] bg-background"
            >
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
              <iframe
                className="h-full w-full border-0 bg-white"
                sandbox="allow-same-origin allow-scripts"
                src={previewUrl}
                title={messages.airapp.previewTitle}
              />
            </section>,
            document.body,
          )
        : null}
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
}

/** "App" tab content: the live preview iframe, optionally topped by a local
 *  run toolbar (see `showToolbar`). */
export function AirAppRunPreview({ runner, airapp, showToolbar = true }: AirAppRunPreviewProps) {
  const messages = useCoreI18n();
  const { status, previewUrl, error } = runner;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showToolbar ? (
        <div className="flex min-h-11 items-center justify-between gap-2 border-border/60 border-b px-4 py-2">
          <span className="font-medium text-muted-foreground text-xs uppercase">
            {messages.airapp.runPanelTitle}
          </span>
          <AirAppRunControls airapp={airapp} runner={runner} showPinToSidePanel={false} />
        </div>
      ) : null}

      {error ? (
        <div className="border-border/60 border-b bg-destructive/5 px-4 py-2 text-destructive text-xs">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {previewUrl ? (
          <iframe
            className="h-full w-full border-0 bg-white"
            sandbox="allow-same-origin allow-scripts"
            src={previewUrl}
            title={messages.airapp.previewTitle}
          />
        ) : (
          <div className="grid h-full min-h-[160px] place-items-center p-6 text-center text-muted-foreground text-sm">
            {status === "idle"
              ? messages.airapp.previewEmpty
              : status === "error"
                ? messages.airapp.previewFailed
                : messages.airapp.previewPending}
          </div>
        )}
      </div>
    </div>
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
    ...orpc.airapps.get.queryOptions({ input: { nodeId } }),
    enabled: Boolean(nodeId),
  });
  const airapp = airappQuery.data ?? null;
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
