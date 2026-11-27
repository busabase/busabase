import "server-only";

import {
  EMBED_SECURITY_HEADERS,
  embedSecurityHeaders,
  isValidEmbedPublicId,
  parseEmbedIframeCapability,
  readEmbedCapabilityCookie,
} from "./capability";
import { renderExpiredEmbedDocument, renderUnavailableEmbedDocument } from "./embed-document";
import { resolveEmbedLink, resolveExpiredEmbedLink } from "./logic";

const htmlResponse = (markup: string, status: number, headers: Record<string, string>) =>
  new Response(markup, {
    status,
    headers: { ...headers, "content-type": "text/html; charset=utf-8" },
  });

const unavailable = (request: Request) =>
  htmlResponse(renderUnavailableEmbedDocument(request.headers.get("accept-language")), 404, {
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
 * hands off to the typed subroute that renders the target. Only the neutral
 * "unavailable" and "expired" states are answered here.
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
    if (!isValidEmbedPublicId(publicId)) return unavailable(request);

    const url = new URL(request.url);
    const direct = parseEmbedIframeCapability(
      url.pathname,
      url.searchParams.get("token"),
      url.searchParams.get("view"),
    );
    const capability = direct ?? readEmbedCapabilityCookie(request.headers.get("cookie"), publicId);
    if (!capability) return unavailable(request);

    const embed = await withHostContext(() => resolveEmbedLink(publicId, capability.secret));
    if (!embed) {
      const expired = await withHostContext(() =>
        resolveExpiredEmbedLink(publicId, capability.secret),
      );
      if (!expired) return unavailable(request);
      return htmlResponse(renderExpiredEmbedDocument(request.headers.get("accept-language")), 410, {
        ...embedSecurityHeaders(expired.framePolicy),
        "x-robots-tag": "noindex, nofollow",
      });
    }

    // Every target renders on a typed subroute: Change Requests and record
    // details, AirApps in their runtime, and every other node type on `node`,
    // which mounts the workbench's own Node Detail components — so an embed
    // shows exactly what the node looks like inside Busabase.
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
    return handOffTo(embed.node.type === "airapp" ? "airapp" : "node");
  };
};
