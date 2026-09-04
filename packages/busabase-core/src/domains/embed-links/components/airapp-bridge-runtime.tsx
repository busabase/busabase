"use client";

import { NodepodRunner } from "busabase-core/domains/airapp/nodepod-runner";
import { AIRAPP_PREVIEW_IFRAME_SANDBOX } from "busabase-core/domains/airapp/preview-sandbox";
import type { AirAppHostedRuntime } from "busabase-core/domains/airapp/runtime-env";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Runs an AirApp in a Nodepod pod whose `/api/v1` calls are RELAYED through the
 * capability-scoped bridge instead of reaching the backend as the viewer.
 *
 * Two surfaces share this, and they must share it — the security properties
 * live in the shape, not in either caller:
 *
 *  - Embed Links (`/embed/{id}/airapp`) — authority is the link's capability.
 *  - Publicly shared AirApps (`/dashboard/{space}/airapp/{slug}`) — authority is
 *    the node's public share, resolved as an anonymous visitor.
 *
 * What makes both safe is that the pod boots WITH a preview script. Nodepod's
 * service worker patch treats "pod has a preview script" as "this pod must
 * never reach the real backend", so a request that bypasses the injected
 * `window.fetch` override (a raw `XMLHttpRequest`, say) is refused with a 403
 * rather than riding the viewer's session cookie into the full REST surface.
 * A viewer of a public link is very often a signed-in stranger, so that guard
 * is not theoretical — see `tests/e2e/airapp-embed-session-leak.spec.ts`.
 *
 * Callers differ only in which credential headers the relay carries.
 */

const REQUEST_MESSAGE = "busabase:embed-fetch-request";
const RESPONSE_MESSAGE = "busabase:embed-fetch-response";
/**
 * What an AirApp itself calls: Busabase's ordinary public REST surface. The
 * same source runs unchanged on a local `pnpm dev` server, in the dashboard's
 * Run panel, and here — a relayed app never knows it is being relayed.
 */
export const BRIDGE_PREFIX = "/api/v1/";
/**
 * Where this host page relays those calls to — the real route, no prefix. It
 * strips `cookie`/`authorization` server-side and re-authorizes against the
 * presented credential, so a relayed app gets that credential's scope and never
 * the viewer's session. Nodepod's service worker keeps this path out of pod
 * routing (see the patch), so a pod's broad path claim cannot capture it.
 */
export const EMBED_BRIDGE_PREFIX = "/api/airapp-embed-bridge/";

const previewBridgeScript = `(() => {
  const REQUEST_MESSAGE = ${JSON.stringify(REQUEST_MESSAGE)};
  const RESPONSE_MESSAGE = ${JSON.stringify(RESPONSE_MESSAGE)};
  const BRIDGE_PREFIX = ${JSON.stringify(BRIDGE_PREFIX)};
  const nativeFetch = window.fetch.bind(window);
  const pending = new Map();
  let sequence = 0;

  const toBase64 = (bytes) => {
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
  };
  const fromBase64 = (value) => {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    const message = event.data;
    if (!message || message.type !== RESPONSE_MESSAGE || typeof message.requestId !== "string") return;
    const deferred = pending.get(message.requestId);
    if (!deferred) return;
    pending.delete(message.requestId);
    if (message.error) deferred.reject(new TypeError(message.error));
    else deferred.resolve(new Response(fromBase64(message.bodyBase64 || ""), {
      status: message.status,
      statusText: message.statusText,
      headers: message.headers,
    }));
  });

  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith(BRIDGE_PREFIX)) {
      return nativeFetch(input, init);
    }
    const requestId = String(++sequence) + ":" + Date.now();
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const bodyBase64 = hasBody ? toBase64(new Uint8Array(await request.clone().arrayBuffer())) : "";
    const response = new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
    window.parent.postMessage({
      type: REQUEST_MESSAGE,
      requestId,
      url: url.pathname + url.search,
      method: request.method,
      headers: Array.from(request.headers.entries()),
      bodyBase64,
    }, window.location.origin);
    return response;
  };
})();`;

const toBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

interface BridgeRequestMessage {
  type: typeof REQUEST_MESSAGE;
  requestId: string;
  url: string;
  method: string;
  headers: Array<[string, string]>;
  bodyBase64: string;
}

const isBridgeRequest = (value: unknown): value is BridgeRequestMessage => {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<BridgeRequestMessage>;
  return (
    message.type === REQUEST_MESSAGE &&
    typeof message.requestId === "string" &&
    typeof message.url === "string" &&
    typeof message.method === "string" &&
    Array.isArray(message.headers) &&
    typeof message.bodyBase64 === "string"
  );
};

export interface AirAppBridgeRuntimeProps {
  /**
   * Credential headers the relay carries — an embed capability, or the space a
   * public share lives in. Neither grants anything by itself: the route
   * re-derives authority server-side from the presented credential.
   */
  bridgeHeaders: Record<string, string>;
  /**
   * Reaches the app as `BUSABASE_AIRAPP_RUNTIME`. Same in-browser engine as the
   * dashboard preview either way; an app may legitimately behave differently
   * when it knows its `/api/v1` access is a relayed, read-only one.
   */
  runtimeKind: AirAppHostedRuntime;
  files: Record<string, string>;
  labels: { loading: string; unavailable: string };
  /** ISO timestamp after which the runtime hard-stops. Omitted = no expiry. */
  expiresAt?: string;
  title: string;
  /**
   * `fullscreen` owns the viewport (the standalone embed page); `fill` grows
   * inside whatever container the caller placed it in (the shared-node page,
   * which keeps its own "Shared with you" header above).
   */
  layout?: "fullscreen" | "fill";
}

export function AirAppBridgeRuntime({
  bridgeHeaders,
  runtimeKind,
  expiresAt,
  files,
  labels,
  layout = "fullscreen",
  title,
}: AirAppBridgeRuntimeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const runnerRef = useRef<NodepodRunner | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  // Header objects are built inline by callers, so a fresh identity every render
  // would restart the relay effects on each one.
  const headerKey = JSON.stringify(bridgeHeaders);
  // biome-ignore lint/correctness/useExhaustiveDependencies: headerKey is the stable identity of bridgeHeaders
  const headers = useMemo(() => bridgeHeaders, [headerKey]);

  useEffect(() => {
    let active = true;
    const runner = new NodepodRunner(previewBridgeScript, runtimeKind);
    runnerRef.current = runner;
    runner.onReady((url) => {
      if (!active) return;
      setPreviewUrl(url);
      setState("ready");
    });
    // A dev server that starts and then dies is the failure mode this surface
    // was blind to: the Service Worker keeps answering the preview origin with
    // "No server on <pod>/<port>", so the iframe renders an error page of its
    // own and the embed sits on "Loading…" forever with nothing in the console.
    // The Run panel has a Logs pane to explain that; neither a public embed nor
    // a public share has any UI at all, so the exit code has to become the
    // visible state. Living here rather than in the embed wrapper is the point
    // of sharing this runtime — both surfaces are equally blind without it.
    runner.onExit((code) => {
      if (!active || code === 0) return;
      setPreviewUrl(null);
      setState("unavailable");
    });
    const startTimer = window.setTimeout(() => {
      void (async () => {
        try {
          await runner.mount(files);
          if (!active) {
            runner.dispose();
            return;
          }
          await runner.install();
          if (!active) {
            runner.dispose();
            return;
          }
          await runner.start();
        } catch {
          if (active) setState("unavailable");
        }
      })();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(startTimer);
      runner.dispose();
      if (runnerRef.current === runner) runnerRef.current = null;
    };
  }, [files, runtimeKind]);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (
        event.source !== iframeRef.current?.contentWindow ||
        event.origin !== window.location.origin ||
        !isBridgeRequest(event.data) ||
        !event.data.url.startsWith(BRIDGE_PREFIX)
      ) {
        return;
      }
      const message = event.data;
      const relayHeaders = new Headers(message.headers);
      relayHeaders.delete("authorization");
      relayHeaders.delete("cookie");
      for (const [name, value] of Object.entries(headers)) {
        relayHeaders.set(name, value);
      }
      const hasBody = message.method !== "GET" && message.method !== "HEAD";
      try {
        // `message.url` is already a real `/api/v1/…` path; the relay route
        // takes everything after its own segment and hands exactly that back to
        // the OpenAPI handler, so nesting rather than substituting keeps it intact.
        //
        // Re-check the path AFTER the browser normalizes it. The prefix test on
        // `message.url` above is not sufficient on its own: the AirApp controls
        // that string, and `/api/v1/../../api/rpc/...` passes `startsWith` yet
        // resolves out of the relay entirely — which would send this page's
        // credential headers to an unrelated same-origin route. Anything that
        // does not land back inside the relay is dropped.
        const bridgeUrl = new URL(
          `${EMBED_BRIDGE_PREFIX.replace(/\/$/, "")}${message.url}`,
          window.location.origin,
        );
        if (!bridgeUrl.pathname.startsWith(EMBED_BRIDGE_PREFIX)) {
          throw new TypeError("Blocked request outside the AirApp data bridge");
        }
        const response = await fetch(bridgeUrl, {
          method: message.method,
          headers: relayHeaders,
          body: hasBody ? fromBase64(message.bodyBase64) : undefined,
          credentials: "omit",
          redirect: "manual",
        });
        const responseHeaders: Array<[string, string]> = [];
        response.headers.forEach((value, name) => {
          responseHeaders.push([name, value]);
        });
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: RESPONSE_MESSAGE,
            requestId: message.requestId,
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            bodyBase64: toBase64(await response.arrayBuffer()),
          },
          window.location.origin,
        );
      } catch (error) {
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: RESPONSE_MESSAGE,
            requestId: message.requestId,
            error: error instanceof Error ? error.message : "Embed request failed",
          },
          window.location.origin,
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [headers]);

  useEffect(() => {
    const markUnavailable = () => {
      runnerRef.current?.dispose();
      runnerRef.current = null;
      setPreviewUrl(null);
      setState("unavailable");
    };
    const expiryTimer = expiresAt
      ? window.setTimeout(markUnavailable, Math.max(0, new Date(expiresAt).getTime() - Date.now()))
      : null;
    // The heartbeat is what makes revocation take effect on an ALREADY-OPEN
    // tab: `_status` runs the same credential resolution as a data call, so a
    // deleted embed link — or a public share that was switched back off —
    // stops the running app instead of leaving it live until reload.
    const checkActive = async () => {
      try {
        const response = await fetch(`${EMBED_BRIDGE_PREFIX}_status`, {
          credentials: "omit",
          headers,
        });
        if (!response.ok) markUnavailable();
      } catch {
        markUnavailable();
      }
    };
    const heartbeat = window.setInterval(() => void checkActive(), 5_000);
    return () => {
      if (expiryTimer !== null) window.clearTimeout(expiryTimer);
      window.clearInterval(heartbeat);
    };
  }, [expiresAt, headers]);

  if (state === "unavailable") {
    return (
      <div
        className={
          layout === "fullscreen"
            ? "grid min-h-dvh place-items-center bg-background text-foreground"
            : "grid h-full place-items-center bg-background text-foreground"
        }
      >
        {labels.unavailable}
      </div>
    );
  }
  return (
    <div
      className={layout === "fullscreen" ? "fixed inset-0 bg-background" : "h-full bg-background"}
    >
      {previewUrl ? (
        <iframe
          className="h-full w-full border-0 bg-white"
          ref={iframeRef}
          sandbox={AIRAPP_PREVIEW_IFRAME_SANDBOX}
          src={previewUrl}
          title={title}
        />
      ) : (
        <div className="grid h-full place-items-center text-muted-foreground">{labels.loading}</div>
      )}
    </div>
  );
}
