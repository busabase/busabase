"use client";

import { consumeEventIterator } from "@orpc/client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AirAppRuntimeEvent } from "busabase-contract/domains/airapp/contract";
import type { AirAppMountedFile, AirAppRunner } from "./types";

/**
 * base64 for the oRPC hop, which is JSON and cannot carry bytes.
 *
 * Chunked rather than `String.fromCharCode(...bytes)` in one spread: a
 * megabyte-scale image would blow the argument limit and throw
 * `RangeError: Maximum call stack size exceeded` — on a 250 KB PNG it happens
 * to survive, so the naive version passes a small fixture and fails on real
 * launch assets.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * `AirAppRunner` implementation backed by a real server-side
 * `npm install` + `npm run dev` OS process. Backs BOTH the `"local"`
 * (bare host Node.js — previewable, data bridge via reverse proxy) and
 * `"srt"` (OS-sandboxed via `@anthropic-ai/sandbox-runtime`'s `SandboxManager`
 * — isolated, but no live preview) engines; the two differ ONLY in the
 * server-side execution mode, selected by the `engine` option passed straight
 * through to the `runLocal` RPC (see `logic/local-runtime.ts`).
 * Driven over the single
 * `airapps.runLocal` oRPC event iterator rather than separate RPCs per
 * `AirAppRunner` method — the server naturally runs install straight into
 * start on one stream (there's no separate "check exit code" call), so this
 * class fans that one subscription back out into the
 * mount/install/start + onLog/onReady shape the interface expects:
 * `mount()` just buffers the files, `install()` opens the subscription and
 * resolves on the server's `"installed"` event (or rejects on a stream
 * error/abort before that point), and `start()` is a no-op — the dev server
 * is already running by the time `install()` resolves, and `onReady`/onLog
 * keep firing from that same subscription.
 */
export class LocalRunner implements AirAppRunner {
  private readonly orpc: BusabaseQueryUtils;
  private readonly nodeId: string;
  private readonly engine: "local" | "srt" | "sandock";
  private files: Record<string, string> = {};
  private binaryFiles: Record<string, string> = {};
  private controller: AbortController | null = null;
  private logCallbacks: Array<(line: string) => void> = [];
  private readyCallbacks: Array<(previewPath: string) => void> = [];
  private exitCallbacks: Array<(code: number | null) => void> = [];
  private lastReadyUrl: string | null = null;
  private installDeferred: { resolve: () => void; reject: (error: unknown) => void } | null = null;

  constructor(options: {
    orpc: BusabaseQueryUtils;
    nodeId: string;
    engine: "local" | "srt" | "sandock";
  }) {
    this.orpc = options.orpc;
    this.nodeId = options.nodeId;
    this.engine = options.engine;
  }

  private emitLog(line: string): void {
    for (const cb of this.logCallbacks) {
      cb(line);
    }
  }

  private emitReady(previewPath: string): void {
    this.lastReadyUrl = previewPath;
    for (const cb of this.readyCallbacks) {
      cb(previewPath);
    }
  }

  private handleEvent(event: AirAppRuntimeEvent): void {
    switch (event.type) {
      case "log":
        this.emitLog(event.line);
        break;
      case "installed":
        this.installDeferred?.resolve();
        this.installDeferred = null;
        break;
      case "ready":
        this.emitReady(event.previewUrl);
        break;
      case "exit":
        this.emitLog(
          `\n[dev server exited${event.code === null ? "" : ` with code ${event.code}`}]\n`,
        );
        for (const cb of this.exitCallbacks) cb(event.code);
        break;
      case "error":
        this.emitLog(`\n[error] ${event.message}\n`);
        this.installDeferred?.reject(new Error(event.message));
        this.installDeferred = null;
        break;
      default:
        break;
    }
  }

  async mount(files: Record<string, AirAppMountedFile>): Promise<void> {
    this.files = {};
    this.binaryFiles = {};
    for (const [filePath, content] of Object.entries(files)) {
      if (typeof content === "string") {
        this.files[filePath] = content;
      } else {
        this.binaryFiles[filePath] = toBase64(content);
      }
    }
  }

  async install(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;

    await new Promise<void>((resolve, reject) => {
      this.installDeferred = { resolve, reject };
      consumeEventIterator(
        this.orpc.airapps.runLocal.call(
          {
            nodeId: this.nodeId,
            files: this.files,
            binaryFiles: this.binaryFiles,
            engine: this.engine,
          },
          { signal: controller.signal },
        ),
        {
          onEvent: (event) => this.handleEvent(event as AirAppRuntimeEvent),
          onError: (error) => {
            if (!controller.signal.aborted) {
              this.installDeferred?.reject(
                error instanceof Error ? error : new Error(String(error)),
              );
            }
            this.installDeferred = null;
          },
          onSuccess: () => {
            // The dev server's exec stream ended (process exited) without a
            // later "installed"/"error" event to resolve/reject on — resolve
            // so a caller mid-`install()` isn't left hanging forever.
            this.installDeferred?.resolve();
            this.installDeferred = null;
          },
        },
      );
    });
  }

  async start(): Promise<void> {
    if (!this.controller) {
      throw new Error("LocalRunner: install() must be called before start()");
    }
    // No-op by design — see class doc comment: the server already continued
    // straight from install into `npm run dev` on the same stream that
    // `install()` subscribed to.
  }

  onLog(cb: (line: string) => void): void {
    this.logCallbacks.push(cb);
  }

  onReady(cb: (previewPath: string) => void): void {
    this.readyCallbacks.push(cb);
    if (this.lastReadyUrl) {
      cb(this.lastReadyUrl);
    }
  }

  onExit(cb: (code: number | null) => void): void {
    this.exitCallbacks.push(cb);
  }

  async stop(): Promise<void> {
    // Aborting the stream only detaches — the server keeps the app running on
    // purpose. Ending it is its own call.
    await this.orpc.airapps.stopLocal.call({ nodeId: this.nodeId });
    this.controller?.abort();
    this.controller = null;
  }

  dispose(): void {
    // Detach only. The run is a server-side session now, and closing a view is
    // not a decision to stop somebody's app.
    this.controller?.abort();
    this.controller = null;
    this.logCallbacks = [];
    this.readyCallbacks = [];
    this.exitCallbacks = [];
  }
}
