"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AirAppVO } from "busabase-contract/types";
import { Button } from "kui/button";
import { Loader2, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { NodepodRunner } from "./runners/nodepod-runner";
import type { AirAppRunner } from "./runners/types";

type RunStatus = "idle" | "loading-files" | "installing" | "starting" | "ready" | "error";

const MAX_LOG_LINES = 2000;

/**
 * Owns the Nodepod runner lifecycle (mount/install/start, log streaming,
 * preview URL) independent of which tab is currently visible. Called once at
 * the AirAppDetailView level so switching between the App/Files/Logs tabs
 * never unmounts this state and never disposes a live running app.
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
  const [status, setStatus] = useState<RunStatus>("idle");
  const [logLines, setLogLines] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runnerRef = useRef<AirAppRunner | null>(null);

  const appendLog = useCallback((chunk: string) => {
    setLogLines((prev) => {
      const next = [...prev, chunk];
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
    });
  }, []);

  // Tear down the runner (kill processes, release the VFS) on unmount or when
  // switching to a different airapp node.
  useEffect(
    () => () => {
      runnerRef.current?.dispose();
      runnerRef.current = null;
    },
    [],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset run state on node change only
  useEffect(() => {
    runnerRef.current?.dispose();
    runnerRef.current = null;
    setStatus("idle");
    setLogLines([]);
    setPreviewUrl(null);
    setError(null);
  }, [airapp?.node.id]);

  const run = useCallback(async () => {
    if (!airapp) {
      return;
    }
    setError(null);
    setPreviewUrl(null);
    setLogLines([]);
    runnerRef.current?.dispose();

    const runner = new NodepodRunner();
    runnerRef.current = runner;
    runner.onLog(appendLog);
    runner.onReady((url) => {
      setPreviewUrl(url);
      setStatus("ready");
    });

    try {
      setStatus("loading-files");
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
      for (const entry of entries) {
        if (entry) {
          files[entry[0]] = entry[1];
        }
      }
      if (Object.keys(files).length === 0) {
        throw new Error(messages.airapp.noRunnableFiles);
      }

      await runner.mount(files);
      setStatus("installing");
      await runner.install();
      setStatus("starting");
      await runner.start();
      // status flips to "ready" from the onReady callback once the dev server
      // actually reports listening — starting a process isn't the same as it
      // being reachable yet.
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.airapp.runFailed);
      setStatus("error");
    }
  }, [appendLog, messages, airapp, orpc, queryClient]);

  const isBusy = status === "loading-files" || status === "installing" || status === "starting";

  return { status, logLines, previewUrl, error, run, isBusy };
}

export type AirAppRunnerState = ReturnType<typeof useAirAppRunner>;

/** "App" tab content: Run button + live preview iframe. */
export function AirAppRunPreview({ runner }: { runner: AirAppRunnerState }) {
  const messages = useCoreI18n();
  const { status, previewUrl, error, run, isBusy } = runner;

  const statusLabel: Record<RunStatus, string> = {
    idle: messages.airapp.statusIdle,
    "loading-files": messages.airapp.statusLoadingFiles,
    installing: messages.airapp.statusInstalling,
    starting: messages.airapp.statusStarting,
    ready: messages.airapp.statusReady,
    error: messages.airapp.statusError,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-11 items-center justify-between gap-2 border-border/60 border-b px-4 py-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-muted-foreground uppercase">
            {messages.airapp.runPanelTitle}
          </span>
          <span className="text-muted-foreground/70">{statusLabel[status]}</span>
        </div>
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
          {status === "ready" || status === "error"
            ? messages.airapp.runAgain
            : messages.airapp.run}
        </Button>
      </div>

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

/** "Logs" tab content: the streaming install/start log console. */
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
      <div className="border-border/50 border-b px-4 py-1.5 font-medium text-[11px] text-muted-foreground uppercase">
        {messages.airapp.logsTitle}
      </div>
      <pre
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-muted/20 p-3 font-mono text-[11px] text-foreground/80 leading-5"
        ref={logRef}
      >
        {logLines.length === 0 ? messages.airapp.logsEmpty : logLines.join("")}
      </pre>
    </div>
  );
}
