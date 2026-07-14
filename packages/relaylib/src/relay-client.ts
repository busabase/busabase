import type WebSocket from "ws";
import { bytesToBase64 } from "./protocol";
import type {
  RelayChunkEncoding,
  RelayClientMessage,
  RelayRequest,
  RelayServerMessage,
} from "./types";

/**
 * Handles a relayed request and returns the response to stream back. Typically
 * forwards to a local HTTP service — see {@link createFetchHandler}. `signal`
 * aborts if the hub sends a `cancel` message (the original caller went away)
 * — long-lived handlers (an oRPC `live.subscribe`, say) must watch it to stop
 * work instead of running forever.
 */
export type RelayRequestHandler = (
  request: RelayRequest,
  signal: AbortSignal,
) => Promise<Response> | Response;

export type RelayClientOptions = {
  /**
   * Wire encoding for response chunks. `"base64"` (default) is binary-safe.
   * `"utf8"` matches the legacy text wire format — chunks are sent as decoded
   * text with no `encoding` field, so a hub that predates base64 support still
   * understands them. Use `"utf8"` until a base64-aware hub is deployed.
   */
  chunkEncoding?: RelayChunkEncoding;
};

/**
 * Wire an already-connected hub socket to a handler: every `request` the hub
 * sends is passed to `handler`, and the resulting `Response` is streamed back
 * as `start` -> `chunk` -> `end` (or `error`).
 *
 * The caller owns the socket lifecycle — connecting to the hub, auth headers,
 * reconnection, heartbeat — so this stays a pure transport loop. The daemon
 * side of relaylib; pairs with {@link RelayHub} on the server side.
 */
export function attachRelayClient(
  socket: WebSocket,
  handler: RelayRequestHandler,
  options: RelayClientOptions = {},
): void {
  const chunkEncoding = options.chunkEncoding ?? "base64";
  // In-flight requests this daemon is currently executing/streaming, keyed by
  // requestId — lets a `cancel` message find and abort the right one. Entries
  // are removed once `handleRequest` settles (success, error, or cancelled).
  const inFlight = new Map<string, AbortController>();
  socket.on("message", (raw) => {
    let message: RelayServerMessage;
    try {
      message = JSON.parse(raw.toString()) as RelayServerMessage;
    } catch {
      return;
    }
    if (message.type === "cancel") {
      inFlight.get(message.requestId)?.abort();
      return;
    }
    if (message.type !== "request") return;
    const controller = new AbortController();
    inFlight.set(message.requestId, controller);
    void handleRequest(
      socket,
      message.requestId,
      message.request,
      handler,
      chunkEncoding,
      controller.signal,
    ).finally(() => {
      inFlight.delete(message.requestId);
    });
  });
}

async function handleRequest(
  socket: WebSocket,
  requestId: string,
  request: RelayRequest,
  handler: RelayRequestHandler,
  chunkEncoding: RelayChunkEncoding,
  signal: AbortSignal,
): Promise<void> {
  const send = (message: RelayClientMessage) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  };

  let response: Response;
  try {
    response = await handler(request, signal);
  } catch (error) {
    if (signal.aborted) return;
    send({ type: "error", requestId, error: errorMessage(error) });
    return;
  }

  send({
    type: "start",
    requestId,
    status: response.status,
    headers: headersToRecord(response.headers),
  });

  try {
    const body = response.body;
    if (body) {
      const reader = body.getReader();
      const onAbort = () => {
        reader.cancel(new Error("Relay request cancelled")).catch(() => {});
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        if (chunkEncoding === "utf8") {
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done || signal.aborted) break;
            const text = decoder.decode(value, { stream: true });
            if (text) send({ type: "chunk", requestId, data: text });
          }
          if (!signal.aborted) {
            const tail = decoder.decode();
            if (tail) send({ type: "chunk", requestId, data: tail });
          }
        } else {
          while (true) {
            const { done, value } = await reader.read();
            if (done || signal.aborted) break;
            if (value && value.length > 0) {
              send({
                type: "chunk",
                requestId,
                encoding: "base64",
                data: bytesToBase64(value),
              });
            }
          }
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
      if (signal.aborted) return;
    }
    send({ type: "end", requestId });
  } catch (error) {
    if (signal.aborted) return;
    send({ type: "error", requestId, error: errorMessage(error) });
  }
}

/**
 * A handler that forwards relayed requests to a local base URL via `fetch`.
 * The base URL is the private service the daemon exposes (e.g. the app's own
 * `http://localhost:3000`).
 */
export function createFetchHandler(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): RelayRequestHandler {
  return (request, signal) => {
    const url = new URL(request.path, baseUrl);
    return fetchImpl(url, {
      method: request.method,
      headers: request.headers,
      body: serializeBody(request.method, request.body),
      signal,
    });
  };
}

function serializeBody(method: string, body: unknown): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  const normalized = method.toUpperCase();
  if (normalized === "GET" || normalized === "HEAD") return undefined;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
    return body as BodyInit;
  }
  return JSON.stringify(body);
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
