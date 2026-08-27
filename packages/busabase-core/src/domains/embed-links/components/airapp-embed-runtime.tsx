"use client";

import { useEffect, useRef, useState } from "react";
import { NodepodRunner } from "../../airapp/components/runners/nodepod-runner";
import { AIRAPP_PREVIEW_IFRAME_SANDBOX } from "../../airapp/utils/preview-sandbox";
import { EMBED_RUNTIME_CAPABILITY_HEADER, EMBED_RUNTIME_NODE_HEADER } from "../capability";

const REQUEST_MESSAGE = "busabase:embed-fetch-request";
const RESPONSE_MESSAGE = "busabase:embed-fetch-response";
/**
 * What an AirApp itself calls: Busabase's ordinary public REST surface. The
 * same source runs unchanged on a local `pnpm dev` server, in the dashboard's
 * Run panel, and here — an embedded app never knows it is being relayed.
 */
const BRIDGE_PREFIX = "/api/v1/";
/**
 * Where this host page relays those calls to — the real route, no prefix. It
 * strips `cookie`/`authorization` server-side and re-authorizes against this
 * embed's capability, so an embedded app gets the embed's scope and never the
 * viewer's session. Nodepod's service worker keeps this path out of pod routing
 * (see the patch), so a pod's broad path claim cannot capture it.
 */
const EMBED_BRIDGE_PREFIX = "/api/airapp-embed-bridge/";

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

interface Props {
  capability: string;
  expiresAt: string;
  files: Record<string, string>;
  labels: {
    loading: string;
    unavailable: string;
  };
  nodeId: string;
  title: string;
}

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

export function AirAppEmbedRuntime({ capability, expiresAt, files, labels, nodeId, title }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const runnerRef = useRef<NodepodRunner | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let active = true;
    // `"embed"` reaches the app as `BUSABASE_AIRAPP_RUNTIME`: same in-browser
    // engine as the dashboard preview, but `/api/v1` here is relayed through a
    // capability-scoped read-only route rather than the viewer's session.
    const runner = new NodepodRunner(previewBridgeScript, "embed");
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
    // The Run panel has a Logs pane to explain that; a public embed has no UI
    // at all, so the exit code has to become the visible state.
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
  }, [files]);

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
      const headers = new Headers(message.headers);
      headers.delete("authorization");
      headers.delete("cookie");
      headers.set(EMBED_RUNTIME_CAPABILITY_HEADER, capability);
      headers.set(EMBED_RUNTIME_NODE_HEADER, nodeId);
      const hasBody = message.method !== "GET" && message.method !== "HEAD";
      try {
        // `message.url` is already a real `/api/v1/…` path; the relay route
        // takes everything after its own segment and hands exactly that back to
        // the OpenAPI handler, so nesting rather than substituting keeps it intact.
        const bridgeUrl = `${EMBED_BRIDGE_PREFIX.replace(/\/$/, "")}${message.url}`;
        const response = await fetch(bridgeUrl, {
          method: message.method,
          headers,
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
  }, [capability, nodeId]);

  useEffect(() => {
    const markUnavailable = () => {
      runnerRef.current?.dispose();
      runnerRef.current = null;
      setPreviewUrl(null);
      setState("unavailable");
    };
    const expiresIn = new Date(expiresAt).getTime() - Date.now();
    const expiryTimer = window.setTimeout(markUnavailable, Math.max(0, expiresIn));
    const checkActive = async () => {
      try {
        const response = await fetch(`${EMBED_BRIDGE_PREFIX}_status`, {
          credentials: "omit",
          headers: {
            [EMBED_RUNTIME_CAPABILITY_HEADER]: capability,
            [EMBED_RUNTIME_NODE_HEADER]: nodeId,
          },
        });
        if (!response.ok) markUnavailable();
      } catch {
        markUnavailable();
      }
    };
    const heartbeat = window.setInterval(() => void checkActive(), 5_000);
    return () => {
      window.clearTimeout(expiryTimer);
      window.clearInterval(heartbeat);
    };
  }, [capability, expiresAt, nodeId]);

  if (state === "unavailable") {
    return (
      <main className="grid min-h-dvh place-items-center bg-background text-foreground">
        {labels.unavailable}
      </main>
    );
  }
  return (
    <main className="fixed inset-0 bg-background">
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
    </main>
  );
}
