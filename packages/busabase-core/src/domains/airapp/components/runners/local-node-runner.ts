"use client";

import { consumeEventIterator } from "@orpc/client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AirAppRuntimeEvent } from "busabase-contract/domains/airapp/contract";
import type { AirAppRunner } from "./types";

/**
 * `AirAppRunner` implementation backed by a real server-side
 * `npm install` + `npm run dev` OS process. Backs BOTH the `"local-node"`
 * (bare host Node.js — previewable, data bridge via reverse proxy) and
 * `"srt"` (OS-sandboxed via `@anthropic-ai/sandbox-runtime`'s `SandboxManager`
 * — isolated, but no live preview) engines; the two differ ONLY in the
 * server-side execution mode, selected by the `engine` option passed straight
 * through to the `runLocalNode` RPC (see `logic/local-node-runtime.ts`).
 * Driven over the single
 * `airapps.runLocalNode` oRPC event iterator rather than separate RPCs per
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
export class LocalNodeRunner implements AirAppRunner {
  private readonly orpc: BusabaseQueryUtils;
  private readonly nodeId: string;
  private readonly engine: "local-node" | "srt";
  private files: Record<string, string> = {};
  private controller: AbortController | null = null;
  private logCallbacks: Array<(line: string) => void> = [];
  private readyCallbacks: Array<(previewPath: string) => void> = [];
  private lastReadyUrl: string | null = null;
  private installDeferred: { resolve: () => void; reject: (error: unknown) => void } | null = null;

  constructor(options: {
    orpc: BusabaseQueryUtils;
    nodeId: string;
    engine: "local-node" | "srt";
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

  async mount(files: Record<string, string>): Promise<void> {
    this.files = files;
  }

  async install(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;

    await new Promise<void>((resolve, reject) => {
      this.installDeferred = { resolve, reject };
      consumeEventIterator(
        this.orpc.airapps.runLocalNode.call(
          { nodeId: this.nodeId, files: this.files, engine: this.engine },
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
      throw new Error("LocalNodeRunner: install() must be called before start()");
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

  dispose(): void {
    this.controller?.abort();
    this.controller = null;
    this.logCallbacks = [];
    this.readyCallbacks = [];
  }
}
