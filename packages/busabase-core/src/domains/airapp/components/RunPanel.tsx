"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AirAppVO } from "busabase-contract/types";
import { Button } from "kui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "kui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "kui/select";
import { Loader2, Maximize2, PanelRightOpen, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { EmptyState } from "../../dashboard/components/primitives";
import { NodeDetailSkeleton } from "../../dashboard/components/skeletons";
import type { SidePanelTabProps } from "../../dashboard/side-panel-registry";
import { useSidePanelStore } from "../../dashboard/store/side-panel-store";
import {
  type AirAppRunStatus,
  IDLE_ENTRY,
  useAirAppRunnerStore,
} from "../store/airapp-runner-store";
import { createAirAppRunner } from "./runners/runner-factory";
import type { AirAppRunnerKind } from "./runners/types";

/**
 * Owns the Nodepod runner lifecycle (mount/install/start, log streaming,
 * preview URL) independent of which tab is currently visible. Called once at
 * the AirAppDetailView level so switching between the App/Files/Logs tabs
 * never unmounts this state and never disposes a live running app.
 *
 * The actual run state lives in `useAirAppRunnerStore`, keyed by node id —
 * NOT in component-local `useState`/`useRef` — because the node-detail
 * registry (`dashboard/node-detail-registry.tsx`) always hands back the same
 * `AirAppDetailView` function reference for every airapp node, so React never
 * unmounts it when the user switches between two different airapp nodes
 * (only the `slug` prop changes). Component-local state would therefore leak
 * across nodes unless explicitly reset — and the previous implementation did
 * that reset by disposing the runner on every node-id change, which also
 * killed a still-running app the moment the user switched away and back.
 * Keying the store by node id gives every node its own independent state
 * with no disposal needed on switch; disposal now only happens via the
 * explicit `disposeEntry` action (see `NodeDeleteButton`'s `onDeleted`).
 */
export function useAirAppRunner({
  orpc,
  airapp,
}: {
  orpc: BusabaseQueryUtils;
  airapp: AirAppVO | null;
}) {
  const messages = useCoreI18n();
  const queryClient = useQueryClient();
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
    runner.onLog((chunk) => useAirAppRunnerStore.getState().appendLog(currentNodeId, chunk));
    runner.onReady((url) => useAirAppRunnerStore.getState().setPreviewUrl(currentNodeId, url));

    try {
      // Mount every text (utf8) file into the runner's virtual filesystem;
      // asset-backed binary files (`encoding: "url"`, e.g. images) are skipped
      // for V1 — Nodepod's virtual fs takes `Uint8Array` too, so binary mounting
      // is a straightforward follow-up, not a hard limitation.
      const entries = await Promise.all(
        airapp.files.map(async (file) => {
          const detail = await queryClient.fetchQuery(
            orpc.airapps.readFile.queryOptions({
              input: { nodeId: airapp.node.id, filePath: file.path },
            }),
          );
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
      useAirAppRunnerStore.getState().setStatus(currentNodeId, "installing");
      await runner.install();
      useAirAppRunnerStore.getState().setStatus(currentNodeId, "starting");
      await runner.start();
      // status flips to "ready" from the onReady callback once the dev server
      // actually reports listening — starting a process isn't the same as it
      // being reachable yet.
    } catch (caught) {
      useAirAppRunnerStore
        .getState()
        .setError(
          currentNodeId,
          caught instanceof Error ? caught.message : messages.airapp.runFailed,
        );
    }
  }, [messages, airapp, orpc, queryClient]);

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
}

/** The run control cluster (status label, pin-to-side-panel, fullscreen + its
 *  Dialog, Run button) shared by the AirApp detail-view header and the
 *  side-panel toolbar so both surfaces stay identical. The fullscreen Dialog
 *  state lives here; the Dialog renders via portal, so where this component
 *  sits in the layout doesn't matter. */
export function AirAppRunControls({ runner, airapp }: AirAppRunControlsProps) {
  const messages = useCoreI18n();
  const { status, previewUrl, run, isBusy, runnerKind, setRunnerKind } = runner;
  const [fullscreen, setFullscreen] = useState(false);

  const statusLabel: Record<AirAppRunStatus, string> = {
    idle: messages.airapp.statusIdle,
    "loading-files": messages.airapp.statusLoadingFiles,
    installing: messages.airapp.statusInstalling,
    starting: messages.airapp.statusStarting,
    ready: messages.airapp.statusReady,
    error: messages.airapp.statusError,
  };

  const pinToSidePanel = () => {
    if (!airapp) {
      return;
    }
    useSidePanelStore.getState().openTab({
      id: `airapp-${airapp.node.id}`,
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
        </SelectContent>
      </Select>
      <span className="hidden text-muted-foreground/70 text-xs md:inline">
        {runnerKind === "local-node"
          ? messages.airapp.engineLocalNodeHint
          : messages.airapp.engineNodepodHint}
      </span>
      {airapp ? (
        <Button
          aria-label={messages.airapp.pinToSidePanel}
          onClick={pinToSidePanel}
          size="icon-sm"
          title={messages.airapp.pinToSidePanel}
          type="button"
          variant="outline"
        >
          <PanelRightOpen className="size-3.5" />
        </Button>
      ) : null}
      {previewUrl ? (
        <Button
          aria-label={messages.recordView.expandFullscreen}
          onClick={() => setFullscreen(true)}
          size="icon-sm"
          title={messages.recordView.expandFullscreen}
          type="button"
          variant="outline"
        >
          <Maximize2 className="size-3.5" />
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
      {previewUrl ? (
        <Dialog onOpenChange={setFullscreen} open={fullscreen}>
          <DialogContent className="flex h-[90vh] max-h-[90vh] w-[95vw] max-w-[1040px] flex-col gap-0 overflow-hidden p-0">
            <DialogHeader className="shrink-0 border-b px-5 py-3 text-left">
              <DialogTitle className="font-medium text-sm">
                {airapp?.node.name ?? messages.airapp.previewTitle}
              </DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1">
              <iframe
                className="h-full w-full border-0 bg-white"
                sandbox="allow-same-origin allow-scripts"
                src={previewUrl}
                title={messages.airapp.previewTitle}
              />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
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
          <AirAppRunControls airapp={airapp} runner={runner} />
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
