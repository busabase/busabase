/**
 * Response hardening for the routes that serve stored objects
 * (`/api/storage/[...key]` in production, `/api/dev/attachment/[...key]` in
 * development — whichever one `STORAGE_URL`'s `base_url=` points at).
 *
 * Content-Type is inferred from the key's extension and the body is served
 * inline with no `Content-Disposition`, and Drive lets any user upload any file
 * through the web UI. A stored `evil.svg` therefore comes back as
 * `image/svg+xml` from the app origin, and navigating to it directly makes it a
 * document — and an SVG document can run script.
 *
 * `Content-Security-Policy: sandbox` drops such a document into an opaque
 * origin with scripting disabled. It is used in preference to
 * `Content-Disposition: attachment` because CSP does not apply to `<img>`, so
 * inline SVG previews keep rendering while a top-level navigation can no longer
 * execute anything. `nosniff` stops a mislabeled payload from being
 * re-interpreted as one of these types.
 *
 * This lives in the app rather than in openlib's `createDevAttachmentRoute`
 * because 12 other apps mount that shared factory.
 */

/** Types a browser will execute if it renders them as a top-level document. */
const SANDBOXED_CONTENT_TYPES = new Set([
  "application/xhtml+xml",
  "application/xml",
  "image/svg+xml",
  "text/html",
  "text/xml",
]);

type StoredObjectHandler = (
  req: Request,
  ctx: { params: Promise<{ key: string[] }> },
) => Promise<Response>;

export function withStoredObjectHardening(serve: StoredObjectHandler): StoredObjectHandler {
  return async (req, ctx) => {
    const response = await serve(req, ctx);
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!contentType || !SANDBOXED_CONTENT_TYPES.has(contentType)) {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.set("content-security-policy", "sandbox");
    headers.set("x-content-type-options", "nosniff");
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}
