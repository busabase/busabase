import "server-only";

/**
 * Same-origin busabase-data bridge for Local Node.js AirApp previews.
 *
 * This is the Local-Node counterpart to Nodepod's Service-Worker bridge: an
 * app running under the Local Node engine is served (via the reverse proxy in
 * `local-preview-proxy.ts`) from the same origin as busabase, so its
 * client-side `fetch("/__busabase_api__/<real-path>")` calls hit *this* server
 * route. We replay the request against `<real-path>` on the same origin,
 * forwarding the browser's session cookie, so it authenticates as the
 * logged-in reviewer exactly like the Nodepod SW bridge does.
 *
 * Nodepod previews never reach this route: their patched Service Worker
 * intercepts `/__busabase_api__/` before the request ever leaves the browser
 * to the network, answering it itself. So the two engines converge on the
 * same bridge prefix through entirely different mechanisms.
 */
export async function bridgeBusabaseApi(req: Request, path: string): Promise<Response> {
  const { origin, search } = new URL(req.url);
  const target = new URL(`/${path}${search}`, origin);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: {
        cookie: req.headers.get("cookie") ?? "",
        "content-type": req.headers.get("content-type") ?? "application/json",
      },
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
      // Propagate the browser's abort so a client disconnect tears the upstream
      // request down cleanly instead of throwing an unhandled ECONNRESET (which
      // crashes the Next.js dev server).
      signal: req.signal,
    });
  } catch (error) {
    if (req.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    return new Response(`busabase-api bridge upstream error: ${String(error)}`, { status: 502 });
  }

  const responseHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) {
    responseHeaders.set("content-type", contentType);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
