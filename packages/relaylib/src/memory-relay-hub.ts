import type WebSocket from "ws";
import { decodeChunk } from "./protocol";
import type { RelayClientMessage, RelayHub, RelayRequest, RelayServerMessage } from "./types";

type PendingRelayRequest = {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  controller?: ReadableStreamDefaultController<Uint8Array>;
  started: boolean;
};

type SocketEntry = {
  socket: WebSocket;
  pending: Map<string, PendingRelayRequest>;
};

const DEFAULT_START_TIMEOUT_MS = 30_000;
const WEB_SOCKET_OPEN_STATE = 1;

export type MemoryRelayHubOptions = {
  /** How long to wait for the daemon's `start` message before failing. */
  startTimeoutMs?: number;
};

/**
 * Single-process relay hub backed by an in-memory map of tunnel id -> socket.
 * This is the transport extracted from apps/buda's connector relay; a
 * Redis-backed hub satisfying {@link RelayHub} can span instances later.
 */
export function createMemoryRelayHub(options: MemoryRelayHubOptions = {}): RelayHub {
  const startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const sockets = new Map<string, SocketEntry>();

  const register: RelayHub["register"] = (id, socket) => {
    const existing = sockets.get(id);
    if (existing) {
      for (const pending of existing.pending.values()) {
        clearTimeout(pending.timeout);
        rejectOrErrorPending(pending, new Error("Relay socket replaced."));
      }
      existing.socket.close();
    }

    sockets.set(id, { socket, pending: new Map() });

    socket.once("close", () => {
      const entry = sockets.get(id);
      if (entry?.socket !== socket) return;
      for (const pending of entry.pending.values()) {
        clearTimeout(pending.timeout);
        rejectOrErrorPending(pending, new Error("Relay socket closed."));
      }
      sockets.delete(id);
    });

    socket.on("message", (raw) => {
      handleSocketMessage(id, raw.toString());
    });
  };

  const isOnline: RelayHub["isOnline"] = (id) => {
    const entry = sockets.get(id);
    return !!entry && entry.socket.readyState === WEB_SOCKET_OPEN_STATE;
  };

  const request: RelayHub["request"] = (id, relayRequest, signal) => {
    const entry = sockets.get(id);
    if (!entry || entry.socket.readyState !== WEB_SOCKET_OPEN_STATE) {
      return Promise.reject(new Error("Relay tunnel is not connected."));
    }

    if (signal?.aborted) {
      return Promise.reject(new Error("Relay request aborted."));
    }

    const requestId = `rel_${crypto.randomUUID()}`;
    const message: RelayServerMessage = {
      type: "request",
      requestId,
      request: relayRequest as RelayRequest,
    };

    return new Promise<Response>((resolve, reject) => {
      const timeout = setTimeout(() => {
        entry.pending.delete(requestId);
        signal?.removeEventListener("abort", onAbort);
        reject(new Error("Relay tunnel request timed out."));
      }, startTimeoutMs);

      const onAbort = () => {
        const pending = entry.pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        entry.pending.delete(requestId);
        rejectOrErrorPending(pending, new Error("Relay request aborted."));
        if (entry.socket.readyState === WEB_SOCKET_OPEN_STATE) {
          const cancelMessage: RelayServerMessage = { type: "cancel", requestId };
          entry.socket.send(JSON.stringify(cancelMessage));
        }
      };

      entry.pending.set(requestId, {
        resolve,
        reject,
        timeout,
        started: false,
      });

      signal?.addEventListener("abort", onAbort, { once: true });

      entry.socket.send(JSON.stringify(message), (error) => {
        if (!error) return;
        clearTimeout(timeout);
        entry.pending.delete(requestId);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      });
    });
  };

  function handleSocketMessage(id: string, raw: string) {
    let message: RelayClientMessage;
    try {
      message = JSON.parse(raw) as RelayClientMessage;
    } catch {
      return;
    }

    const entry = sockets.get(id);
    if (!entry) return;

    const pending = entry.pending.get(message.requestId);
    if (!pending) return;

    if (message.type === "start") {
      clearTimeout(pending.timeout);
      pending.started = true;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          pending.controller = controller;
        },
      });
      pending.resolve(
        new Response(stream, {
          status: message.status,
          headers: sanitizeResponseHeaders(message.headers),
        }),
      );
      return;
    }

    if (message.type === "chunk") {
      pending.controller?.enqueue(decodeChunk(message.data, message.encoding));
      return;
    }

    clearTimeout(pending.timeout);
    entry.pending.delete(message.requestId);

    if (message.type === "error") {
      rejectOrErrorPending(pending, new Error(message.error));
      return;
    }

    pending.controller?.close();
  }

  return { register, isOnline, request };
}

function rejectOrErrorPending(pending: PendingRelayRequest, error: Error) {
  if (pending.started) {
    pending.controller?.error(error);
  } else {
    pending.reject(error);
  }
}

function sanitizeResponseHeaders(headers?: Record<string, string>): Headers {
  const result = new Headers();
  if (!headers) return result;

  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();
    if (
      normalized === "connection" ||
      normalized === "content-length" ||
      normalized === "keep-alive" ||
      normalized === "transfer-encoding" ||
      normalized === "upgrade"
    ) {
      continue;
    }
    result.set(key, value);
  }

  return result;
}
