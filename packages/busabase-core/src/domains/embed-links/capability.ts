export const EMBED_CAPABILITY_COOKIE_PREFIX = "busabase_embed_";
export const EMBED_CAPABILITY_MAX_AGE_SECONDS = 24 * 60 * 60;
export const EMBED_PUBLIC_ID_PATTERN = /^emb_[A-Za-z0-9_-]{16}$/;
export const EMBED_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const EMBED_IFRAME_VIEW = "iframe";
export const EMBED_RUNTIME_CAPABILITY_HEADER = "x-busabase-embed-capability";
export const EMBED_RUNTIME_NODE_HEADER = "x-busabase-embed-airapp";

export const EMBED_BASE_SECURITY_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

/** Structural mirror of `EmbedFramePolicyVO`, kept here so this module stays
 * dependency-free for the proxies that import it. */
export interface EmbedFramePolicy {
  mode: "anywhere" | "origins" | "top-level-only";
  allowedOrigins: string[];
}

export const embedSecurityHeaders = (policy: EmbedFramePolicy): Record<string, string> => {
  if (policy.mode === "top-level-only") {
    return {
      ...EMBED_BASE_SECURITY_HEADERS,
      "content-security-policy": "frame-ancestors 'none'",
      "x-frame-options": "DENY",
    };
  }

  return {
    ...EMBED_BASE_SECURITY_HEADERS,
    "content-security-policy":
      policy.mode === "anywhere"
        ? "frame-ancestors *"
        : `frame-ancestors ${policy.allowedOrigins.join(" ")}`,
  };
};

export const EMBED_SECURITY_HEADERS = embedSecurityHeaders({
  mode: "top-level-only",
  allowedOrigins: [],
});

/**
 * Cross-origin isolation for the public AirApp embed.
 *
 * Nodepod (the in-browser Node runtime the embed boots) needs
 * `SharedArrayBuffer` for its threaded WASI modules, lean worker snapshots and
 * sync child-process APIs. Without these two headers it degrades to a path that
 * cannot serve the app at all — the embed sits on "Loading app…" forever while
 * the console shows `SharedArrayBuffer unavailable` and the virtual preview
 * origin 503s. Nothing about that failure points at a missing header.
 *
 * Both hosts already send this pair on their authenticated dashboard AirApp
 * routes (`next.config.mjs`). The public embed route is served through the
 * proxy instead, because its CSP is per-link
 * (`framePolicy`) and a static `next.config` rule would flatten that.
 *
 * `credentialless` rather than `require-corp`, matching the dashboard routes:
 * Nodepod pulls tool WASM from esm.sh / jsdelivr, which do not send CORP.
 */
export const EMBED_AIRAPP_ISOLATION_HEADERS = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "credentialless",
} as const;

/** True for the public AirApp embed route, which needs the isolation pair above. */
export const isEmbedAirAppPath = (pathname: string): boolean =>
  /^\/embed\/[^/]+\/airapp$/.test(pathname);

/**
 * The complete response header set for an embed request: the per-link frame
 * policy, plus cross-origin isolation when this is the AirApp route.
 *
 * Both hosts need exactly this pair of decisions and were making them
 * separately — one building a plain object, one setting fields on a
 * `NextResponse`. Deciding here keeps "which headers does an embed response
 * carry" in one place; each host still owns how it applies them.
 */
export const embedResponseHeaders = (
  pathname: string,
  policy: EmbedFramePolicy | null,
): Record<string, string> => {
  const headers = policy ? embedSecurityHeaders(policy) : EMBED_SECURITY_HEADERS;
  return isEmbedAirAppPath(pathname) ? { ...headers, ...EMBED_AIRAPP_ISOLATION_HEADERS } : headers;
};

export const isValidEmbedPublicId = (value: string): boolean => EMBED_PUBLIC_ID_PATTERN.test(value);
export const isValidEmbedSecret = (value: string): boolean => EMBED_SECRET_PATTERN.test(value);

export const embedCapabilityCookieName = (id: string): string =>
  `${EMBED_CAPABILITY_COOKIE_PREFIX}${id}`;

export const encodeEmbedCapability = (id: string, secret: string): string => `${id}.${secret}`;

export const embedPublicIdFromPath = (pathname: string): string | null => {
  const match = pathname.match(/^\/embed\/([^/]+)(?:\/(?:airapp|change-request|record-detail))?$/);
  const id = match?.[1] ?? "";
  return isValidEmbedPublicId(id) ? id : null;
};

/** `?token=` on an embed route, validated — regardless of which view asked. */
const parseEmbedTokenCapability = (
  pathname: string,
  token: string | null,
): { id: string; secret: string } | null => {
  const id = embedPublicIdFromPath(pathname);
  return id && token && isValidEmbedSecret(token) ? { id, secret: token } : null;
};

/**
 * A TOP-LEVEL open, which the proxy exchanges for an HttpOnly cookie.
 *
 * The two parses below are the same read of the same URL; what differs is only
 * which side of `view=iframe` each caller wants, because the two are handled
 * oppositely: a top-level visit gets its token moved into a cookie (keeping it
 * out of history and copied URLs), while an iframe has to keep passing it
 * directly — third-party cookie policy cannot be relied on across hosts.
 */
export const parseEmbedBootstrap = (
  pathname: string,
  token: string | null,
  view: string | null = null,
): { id: string; secret: string } | null =>
  view === EMBED_IFRAME_VIEW ? null : parseEmbedTokenCapability(pathname, token);

/** The iframe half of the split described above. */
export const parseEmbedIframeCapability = (
  pathname: string,
  token: string | null,
  view: string | null,
): { id: string; secret: string } | null =>
  view === EMBED_IFRAME_VIEW ? parseEmbedTokenCapability(pathname, token) : null;

/**
 * Read this link's capability out of a raw `Cookie:` header.
 *
 * Takes the header rather than a framework request object so the shared route
 * handler stays on standard Web APIs — `busabase-core` deliberately carries no
 * `next` dependency (it also backs the CLI, SDK and mobile clients).
 */
export const readEmbedCapabilityCookie = (
  cookieHeader: string | null,
  publicId: string,
): { id: string; secret: string } | null => {
  if (!cookieHeader) return null;
  const name = embedCapabilityCookieName(publicId);
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const decoded = decodeEmbedCapability(decodeURIComponent(part.slice(separator + 1).trim()));
    if (decoded?.id === publicId) return decoded;
  }
  return null;
};

export const decodeEmbedCapability = (
  value: string | undefined,
): { id: string; secret: string } | null => {
  if (!value) return null;
  const separator = value.indexOf(".");
  if (separator <= 0 || separator === value.length - 1) return null;
  const id = value.slice(0, separator);
  const secret = value.slice(separator + 1);
  return isValidEmbedPublicId(id) && isValidEmbedSecret(secret) ? { id, secret } : null;
};

/**
 * Public-share mode of the AirApp data bridge.
 *
 * A publicly shared AirApp runs in the SAME relay as an Embed Link — same route,
 * same credential-stripping, same read-only router — but authorizes off the
 * node's public share instead of an embed capability. Reusing the one relay is
 * deliberate: Nodepod's service worker patch keeps `/api/airapp-embed-bridge/`
 * out of pod routing and refuses `/api/v1/*` from any pod that booted with a
 * preview script, so a second, parallel bridge path would silently sit outside
 * both of those protections.
 *
 * The space id is all this header carries — it names WHICH tenant to resolve the
 * share in, and grants nothing on its own. Authorization is re-derived
 * server-side from `busabase_nodes.effective_public_scope`.
 */
export const PUBLIC_SHARE_RUNTIME_SPACE_HEADER = "x-busabase-public-share-space";
