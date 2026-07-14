/**
 * Wire protocol + public interface for the relay tunnel transport.
 *
 * A relay tunnel lets a private daemon (keyed by an opaque string id) hold a
 * persistent WebSocket to a hub. The hub can then issue HTTP-shaped requests
 * that the daemon executes locally and streams back. Transport only — no auth,
 * no persistence, no app-specific types.
 */
import type WebSocket from "ws";

export type { WebSocket };

/** HTTP-shaped request the hub sends down a registered tunnel. */
export type RelayRequest = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
};

/** Daemon -> hub: response has started; headers + status are known. */
export type RelayStart = {
  type: "start";
  requestId: string;
  status: number;
  headers?: Record<string, string>;
};

/** How a chunk's `data` string encodes its bytes. */
export type RelayChunkEncoding = "utf8" | "base64";

/**
 * Daemon -> hub: a chunk of the response body.
 *
 * `encoding` is optional for backward compatibility: omitted means `"utf8"`
 * (`data` is the raw text), which is how the original buda daemon speaks. New
 * clients send `"base64"` so binary payloads round-trip intact.
 */
export type RelayChunk = {
  type: "chunk";
  requestId: string;
  data: string;
  encoding?: RelayChunkEncoding;
};

/** Daemon -> hub: response body is complete. */
export type RelayEnd = {
  type: "end";
  requestId: string;
};

/** Daemon -> hub: the request failed on the daemon side. */
export type RelayError = {
  type: "error";
  requestId: string;
  error: string;
};

/** Messages a daemon sends back to the hub. */
export type RelayClientMessage = RelayStart | RelayChunk | RelayEnd | RelayError;

/** Hub -> daemon: please execute this request. */
export type RelayRequestMessage = {
  type: "request";
  requestId: string;
  request: RelayRequest;
};

/**
 * Hub -> daemon: the caller went away — stop executing/streaming this request.
 * Sent when the hub-side caller's own `AbortSignal` fires (e.g. a browser tab
 * navigated away mid long-lived stream, like an oRPC `live.subscribe`). The
 * daemon should abort its local handler and stop sending further chunks; no
 * reply is expected (the hub has already discarded the pending entry).
 */
export type RelayCancel = {
  type: "cancel";
  requestId: string;
};

/** Hub -> daemon message union. */
export type RelayServerMessage = RelayRequestMessage | RelayCancel;

/**
 * A relay hub multiplexes many tunnels by id over their WebSockets and turns a
 * `request(id, ...)` call into a streamed `Response`. The in-memory
 * implementation handles a single process; a Redis-backed implementation
 * (cross-instance) can satisfy the same interface later.
 */
export interface RelayHub {
  /** Register (or replace) the socket for a tunnel id. */
  register(id: string, socket: WebSocket): void;
  /** Whether a tunnel id currently has an open socket. */
  isOnline(id: string): boolean;
  /**
   * Issue a request down a tunnel and resolve with a streamed Response.
   * When `signal` aborts, a `cancel` message is sent to the daemon and the
   * pending entry is torn down immediately — callers must not rely on the
   * returned Response settling after that point.
   */
  request(id: string, request: RelayRequest, signal?: AbortSignal): Promise<Response>;
}
