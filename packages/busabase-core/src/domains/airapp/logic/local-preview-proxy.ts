import "server-only";

import { getLocalPreviewPort } from "./local-preview-registry";

/**
 * Server-side reverse proxy for a running Local Node.js AirApp preview.
 *
 * The Local Node engine spawns a real OS process listening on
 * `http://localhost:{port}` — a *different origin* from the busabase server,
 * so the dashboard's preview iframe can't point at it directly and still share
 * busabase's session/origin. Instead the runtime emits a same-origin preview
 * URL (`/__airapp_preview__/{nodeId}/`) and this handler forwards each such
 * request to the real localhost process, streaming the response back. Being
 * same-origin is what makes the sibling `/__busabase_api__/` bridge work for
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
): Promise<Response> {
  const port = getLocalPreviewPort(nodeId);
  if (port === undefined) {
    return new Response("AirApp preview not running", { status: 404 });
  }

  const search = new URL(req.url).search;
  const target = `http://127.0.0.1:${port}/${path}${search}`;

  // Forward the incoming headers, stripping hop-by-hop / origin-specific ones
  // that must not be replayed against the upstream localhost server.
  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("connection");

  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
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
    return new Response(`AirApp preview upstream error: ${String(error)}`, { status: 502 });
  }

  const responseHeaders = new Headers();
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

  // For the HTML document, inject a `<base href>` pointing at this preview's
  // sub-path so the app's *relative* asset/link URLs (`style.css`, `client.js`)
  // resolve under `/api/airapp-preview/{nodeId}/…` — independent of whether the
  // iframe URL kept its trailing slash (Next.js normalizes `…/{nodeId}/` →
  // `…/{nodeId}`, which would otherwise drop the nodeId from relative refs).
  // Absolute refs like `/__busabase_api__/…` are unaffected by `<base>` and
  // still hit the busabase origin root (the data bridge). Non-HTML responses
  // (the assets themselves, JSON, etc.) stream through untouched.
  if (contentType?.includes("text/html")) {
    const html = await upstream.text();
    const baseTag = `<base href="/api/airapp-preview/${nodeId}/">`;
    const withBase = html.includes("<head>")
      ? html.replace("<head>", `<head>${baseTag}`)
      : `${baseTag}${html}`;
    return new Response(withBase, { status: upstream.status, headers: responseHeaders });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
