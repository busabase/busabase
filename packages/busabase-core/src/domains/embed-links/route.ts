import "server-only";

import {
  EMBED_SECURITY_HEADERS,
  embedSecurityHeaders,
  isValidEmbedPublicId,
  parseEmbedIframeCapability,
  readEmbedCapabilityCookie,
} from "./capability";
import { renderEmbedDocument, renderUnavailableEmbedDocument } from "./embed-document";
import { resolveEmbedLink } from "./logic";

const htmlResponse = (markup: string, status: number, headers: Record<string, string>) =>
  new Response(markup, {
    status,
    headers: { ...headers, "content-type": "text/html; charset=utf-8" },
  });

const unavailable = () =>
  htmlResponse(renderUnavailableEmbedDocument(), 404, {
    ...EMBED_SECURITY_HEADERS,
    "x-robots-tag": "noindex, nofollow",
  });

export interface EmbedRouteOptions {
  /**
   * Runs link resolution inside the host's own context — Cloud injects
   * `resolveEmbedActorState` so the creator's account, membership and API-key
   * state are checked. Desktop has no such state and omits it.
   */
  withHostContext?: <T>(fn: () => Promise<T>) => Promise<T>;
  /**
   * Base for the typed-subroute redirects. Cloud pins its canonical app URL
   * (it is multi-tenant and serves several hostnames); Desktop follows the
   * request's own origin.
   */
  redirectBase?: (request: Request) => string;
}

/**
 * `GET /embed/:publicId` — the public entry point for every embed target,
 * shared by both hosts.
 *
 * Resolves the capability (an iframe passes `?token=` directly; a top-level
 * visit arrives with the HttpOnly cookie the proxy exchanged it for), then
 * either renders the node document inline or hands off to the typed subroute
 * that owns richer rendering.
 */
export const createEmbedRouteHandler = ({
  withHostContext = (fn) => fn(),
  redirectBase = (request) => new URL(request.url).origin,
}: EmbedRouteOptions = {}) => {
  return async (
    request: Request,
    context: { params: Promise<{ publicId: string }> },
  ): Promise<Response> => {
    const { publicId } = await context.params;
    if (!isValidEmbedPublicId(publicId)) return unavailable();

    const url = new URL(request.url);
    const direct = parseEmbedIframeCapability(
      url.pathname,
      url.searchParams.get("token"),
      url.searchParams.get("view"),
    );
    const capability = direct ?? readEmbedCapabilityCookie(request.headers.get("cookie"), publicId);
    if (!capability) return unavailable();

    const embed = await withHostContext(() => resolveEmbedLink(publicId, capability.secret));
    if (!embed) return unavailable();

    // Change Requests, record details and AirApps each have a subroute that
    // renders them properly; only plain node documents are served inline.
    const handOffTo = (subroute: string) => {
      const target = new URL(
        `/embed/${encodeURIComponent(publicId)}/${subroute}`,
        redirectBase(request),
      );
      // An iframe keeps passing its token: third-party cookie policy cannot be
      // relied on across hosts, so the subroute has to be reachable directly.
      if (direct) {
        target.searchParams.set("token", direct.secret);
        target.searchParams.set("view", "iframe");
      }
      return new Response(null, {
        status: 307,
        headers: { ...embedSecurityHeaders(embed.framePolicy), location: target.toString() },
      });
    };

    if (embed.type !== "node") return handOffTo(embed.type);
    if (embed.detail.type === "airapp") return handOffTo("airapp");

    return htmlResponse(renderEmbedDocument(embed.detail, embed.targetName), 200, {
      ...embedSecurityHeaders(embed.framePolicy),
      "x-robots-tag": "noindex, nofollow",
    });
  };
};
