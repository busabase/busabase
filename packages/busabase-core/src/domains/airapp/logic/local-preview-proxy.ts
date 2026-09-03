import "server-only";

import { type DefaultTreeAdapterMap, defaultTreeAdapter, parse, serialize } from "parse5";
import { getLocalPreviewTarget } from "./local-preview-registry";

const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const SENSITIVE_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authenticate",
  "proxy-authorization",
  "x-api-key",
  "forwarded",
  "via",
  "x-real-ip",
]);

const PREVIEW_RETRYABLE_STATUSES = new Set([502, 503, 504]);
const PREVIEW_MAX_GET_ATTEMPTS = 5;
const PREVIEW_RETRY_DELAY_MS = 500;
const ROOT_URL_ATTRIBUTE_NAMES = new Set(["action", "href", "poster", "src"]);
const ROOT_SRCSET_ATTRIBUTE_NAMES = new Set(["imagesrcset", "srcset"]);

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

const isHtmlElement = (node: HtmlNode): node is HtmlElement => "tagName" in node;

const isBusabaseDataBridgeUrl = (url: string): boolean => /^\/api\/v1(?:[/?#]|$)/.test(url);

const previewBridgeScript = (previewPrefix: string): string =>
  [
    "(() => {",
    `  const previewPrefix = ${JSON.stringify(previewPrefix)};`,
    "  const rewriteUrl = (value) => {",
    "    const raw = String(value);",
    '    const rootRelative = raw.startsWith("/") && !raw.startsWith("//");',
    "    const absolute = /^[a-zA-Z][a-zA-Z\\d+.-]*:/.test(raw);",
    "    if (!rootRelative && !absolute) return value;",
    "    try {",
    "      const url = new URL(raw, window.location.href);",
    "      if (",
    "        url.origin !== window.location.origin ||",
    "        url.pathname === previewPrefix ||",
    '        url.pathname.startsWith(previewPrefix + "/") ||',
    '        url.pathname === "/api/v1" ||',
    '        url.pathname.startsWith("/api/v1/")',
    "      ) {",
    "        return value;",
    "      }",
    "      url.pathname = previewPrefix + url.pathname;",
    "      return url.href;",
    "    } catch {",
    "      return value;",
    "    }",
    "  };",
    "",
    "  const nativeFetch = window.fetch.bind(window);",
    "  window.fetch = (input, init) => {",
    "    if (window.Request && input instanceof window.Request) {",
    "      const url = rewriteUrl(input.url);",
    "      return nativeFetch(url === input.url ? input : new window.Request(url, input), init);",
    "    }",
    "    return nativeFetch(rewriteUrl(input), init);",
    "  };",
    "",
    "  const xhrOpen = window.XMLHttpRequest?.prototype.open;",
    "  if (xhrOpen) {",
    "    window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {",
    "      return xhrOpen.call(this, method, rewriteUrl(url), ...rest);",
    "    };",
    "  }",
    "",
    "  const NativeEventSource = window.EventSource;",
    "  if (NativeEventSource) {",
    "    window.EventSource = class extends NativeEventSource {",
    "      constructor(url, options) {",
    "        super(rewriteUrl(url), options);",
    "      }",
    "    };",
    "  }",
    "",
    "  const nativeSendBeacon = window.navigator?.sendBeacon?.bind(window.navigator);",
    "  if (nativeSendBeacon) {",
    "    window.navigator.sendBeacon = (url, data) => nativeSendBeacon(rewriteUrl(url), data);",
    "  }",
    "})();",
  ].join("\n");

const previewDocumentHtml = (html: string, nodeId: string): string => {
  const previewPrefix = `/api/airapp-preview/${encodeURIComponent(nodeId)}`;
  const rewriteRootUrl = (url: string): string => {
    if (
      isBusabaseDataBridgeUrl(url) ||
      url === previewPrefix ||
      url.startsWith(`${previewPrefix}/`) ||
      url.startsWith(`${previewPrefix}?`) ||
      url.startsWith(`${previewPrefix}#`)
    ) {
      return url;
    }
    return `${previewPrefix}${url}`;
  };
  const document = parse(html);
  let head: HtmlElement | undefined;
  let base: HtmlElement | undefined;

  const visit = (node: HtmlNode) => {
    if (isHtmlElement(node)) {
      if (node.tagName === "head") head ??= node;
      if (node.tagName === "base") base ??= node;
      for (const attribute of node.attrs) {
        if (
          ROOT_URL_ATTRIBUTE_NAMES.has(attribute.name) &&
          attribute.value.startsWith("/") &&
          !attribute.value.startsWith("//")
        ) {
          attribute.value = rewriteRootUrl(attribute.value);
        } else if (ROOT_SRCSET_ATTRIBUTE_NAMES.has(attribute.name)) {
          attribute.value = attribute.value.replace(
            /(^|,\s*)(\/(?!\/)[^\s,]+)/g,
            (_candidate, separator: string, url: string) => `${separator}${rewriteRootUrl(url)}`,
          );
        }
      }
      if ("content" in node) visit(node.content);
    }
    if ("childNodes" in node) {
      for (const child of node.childNodes) visit(child);
    }
  };
  visit(document);

  const baseHref = `${previewPrefix}/`;
  if (base) {
    const href = base.attrs.find((attribute) => attribute.name === "href");
    if (href) href.value = baseHref;
    else base.attrs.push({ name: "href", value: baseHref });
    defaultTreeAdapter.detachNode(base);
    const firstChild = head?.childNodes[0];
    if (head && firstChild) defaultTreeAdapter.insertBefore(head, base, firstChild);
    else if (head) defaultTreeAdapter.appendChild(head, base);
  } else if (head) {
    base = defaultTreeAdapter.createElement("base", head.namespaceURI, [
      { name: "href", value: baseHref },
    ]);
    const firstChild = head.childNodes[0];
    if (firstChild) defaultTreeAdapter.insertBefore(head, base, firstChild);
    else defaultTreeAdapter.appendChild(head, base);
  }

  if (head && base) {
    const bridge = defaultTreeAdapter.createElement("script", head.namespaceURI, [
      { name: "data-busabase-airapp-preview-bridge", value: "" },
    ]);
    defaultTreeAdapter.appendChild(
      bridge,
      defaultTreeAdapter.createTextNode(previewBridgeScript(previewPrefix)),
    );
    const baseIndex = head.childNodes.indexOf(base);
    const nextSibling = head.childNodes[baseIndex + 1];
    if (nextSibling) defaultTreeAdapter.insertBefore(head, bridge, nextSibling);
    else defaultTreeAdapter.appendChild(head, bridge);
  }

  return serialize(document);
};

const previewRequestHeaders = (requestHeaders: Headers): Headers => {
  const headers = new Headers(requestHeaders);

  // RFC 9110 lets Connection name additional per-hop headers. Read that list
  // before deleting Connection itself, otherwise an attacker can smuggle a
  // credential through a made-up hop header that this proxy would replay.
  for (const name of headers.get("connection")?.split(",") ?? []) {
    const normalized = name.trim().toLowerCase();
    if (normalized) headers.delete(normalized);
  }

  for (const name of HOP_BY_HOP_REQUEST_HEADERS) headers.delete(name);
  for (const name of SENSITIVE_REQUEST_HEADERS) headers.delete(name);
  headers.delete("host");

  // These headers carry Cloud routing, provenance and permission context. An
  // AirApp is reviewed content but still untrusted code, so none of the host's
  // private namespace may cross this boundary.
  for (const name of [...headers.keys()]) {
    const normalized = name.toLowerCase();
    if (normalized.startsWith("x-busabase-") || normalized.startsWith("x-forwarded-")) {
      headers.delete(name);
    }
  }
  return headers;
};

/**
 * Server-side reverse proxy for a running Local Node.js AirApp preview.
 *
 * The Local Node engine spawns a real OS process listening on
 * `http://localhost:{port}` — a *different origin* from the busabase server,
 * so the dashboard's preview iframe can't point at it directly and still share
 * busabase's session/origin. Instead the runtime emits a same-origin preview
 * URL (`/__airapp_preview__/{nodeId}/`) and this handler forwards each such
 * request to the real localhost process, streaming the response back. Being
 * same-origin is what lets a previewed app reach `/api/v1` directly under
 * Local Node the way Nodepod's Service Worker does for its in-browser engine.
 *
 * HTTP only: the data demos this exists for are plain `node:http` servers, so
 * WebSocket / Vite-HMR `Upgrade` requests are not proxied (they'd need raw
 * socket hijacking, which the Fetch-based route handler can't do). Live-reload
 * for those frameworks simply won't tunnel through — acceptable for the
 * read-only data views this bridge targets.
 */
export async function proxyLocalPreview(
  req: Request,
  nodeId: string,
  path: string,
  /**
   * Who is asking. Resolved by the calling app, because only the app knows how
   * its own requests authenticate: the cloud host reads its session, the
   * open-source single-user host has one owner and passes the shared constant.
   * A run is only visible to the owner that started it — starting one requires
   * `write` on the node, and before this parameter existed, *viewing* one
   * required nothing but knowing the nodeId.
   */
  owner: string,
): Promise<Response> {
  const connectionTokens = req.headers
    .get("connection")
    ?.split(",")
    .map((value) => value.trim().toLowerCase());
  if (req.headers.has("upgrade") || connectionTokens?.includes("upgrade")) {
    return new Response(
      "WebSocket AirApp previews are not supported; use HTTP or Server-Sent Events.",
      { status: 501 },
    );
  }

  const target = await getLocalPreviewTarget(nodeId, owner);
  if (target === undefined) {
    // Deliberately the same 404 as "no run at all": distinguishing
    // "running, but not yours" would confirm to a stranger that a given node
    // is being previewed right now.
    return new Response("AirApp preview not running", { status: 404 });
  }

  const search = new URL(req.url).search;
  const upstreamUrl = `${target}/${path}${search}`;

  // Forward ordinary application headers, never host credentials or routing
  // context. The upstream is an untrusted AirApp, including when it runs in a
  // remote Sandock sandbox rather than on localhost.
  const headers = previewRequestHeaders(req.headers);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const canRetry = req.method === "GET" || req.method === "HEAD";
  const maxAttempts = canRetry ? PREVIEW_MAX_GET_ATTEMPTS : 1;
  let upstream: Response | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers,
        body: hasBody ? await req.arrayBuffer() : undefined,
        redirect: "manual",
        // Propagate the browser's abort so the upstream request tears down with
        // the client instead of throwing an unhandled ECONNRESET (which crashes
        // the Next.js dev server).
        signal: req.signal,
      });
    } catch (error) {
      if (req.signal.aborted) {
        return new Response(null, { status: 499 });
      }
      if (attempt === maxAttempts) {
        return new Response(`AirApp preview upstream error: ${String(error)}`, { status: 502 });
      }
      await new Promise((resolve) => setTimeout(resolve, PREVIEW_RETRY_DELAY_MS));
      continue;
    }
    if (attempt < maxAttempts && PREVIEW_RETRYABLE_STATUSES.has(upstream.status)) {
      await upstream.body?.cancel().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, PREVIEW_RETRY_DELAY_MS));
      continue;
    }
    break;
  }
  if (!upstream) {
    return new Response("AirApp preview upstream unavailable", { status: 502 });
  }

  const responseHeaders = new Headers();

  // The dashboard page that frames this preview is served cross-origin-isolated
  // (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy:
  // credentialless`) so Nodepod can use SharedArrayBuffer. COEP is *inherited
  // by nested documents*: an iframe whose response does not itself assert a
  // COEP is refused, and being same-origin does not exempt it. Without these
  // two headers the browser fails the frame navigation with
  // `ERR_BLOCKED_BY_RESPONSE` — the server logs a clean 200, the proxy is
  // demonstrably returning correct HTML, and the preview is simply blank.
  //
  // `credentialless` rather than `require-corp` to match the embedder, and so
  // an AirApp loading a cross-origin CDN asset doesn't need that CDN to send
  // its own CORP header.
  responseHeaders.set("Cross-Origin-Embedder-Policy", "credentialless");
  responseHeaders.set("Cross-Origin-Resource-Policy", "same-origin");

  const contentType = upstream.headers.get("content-type");
  if (contentType) {
    responseHeaders.set("content-type", contentType);
  }
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) {
    responseHeaders.set("cache-control", cacheControl);
  }
  const location = upstream.headers.get("location");
  if (location) {
    responseHeaders.set("location", location);
  }

  // For the HTML document, inject a `<base href>` for relative URLs and rewrite
  // root-relative document URLs (`/style.css`, `/client.js`) into this preview
  // sub-path. `<base>` alone cannot affect those leading-slash URLs, which are
  // common in the seeded AirApps and otherwise resolve against Busabase itself.
  // `<base>` also cannot affect JavaScript's root-relative `fetch("/api/...")`,
  // XHR, EventSource or sendBeacon calls. The injected bridge maps those calls
  // to the preview prefix while deliberately preserving `/api/v1` at the
  // Busabase origin root as the same-origin data bridge. Non-HTML responses
  // (the assets themselves, JSON, etc.) continue to stream through untouched.
  if (contentType?.includes("text/html")) {
    const html = await upstream.text();
    return new Response(previewDocumentHtml(html, nodeId), {
      status: upstream.status,
      headers: responseHeaders,
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
