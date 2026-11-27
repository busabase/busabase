import type { EmbedTargetNodeVO } from "../types";
import { isEmbedNodeRoute } from "./node-route";

export type EmbedContentLink =
  | { kind: "fragment"; hash: string }
  | { kind: "route"; path: string }
  | { kind: "asset" }
  | { kind: "external"; href: string }
  | { kind: "contact" }
  | { kind: "blocked" };

/**
 * Content links use the embed's memory router for node routes. A relative
 * query therefore belongs to that route, not the physical `/embed/:id/node`.
 * The asset exception is only this link's own authorized asset surface; a
 * `download` attribute must not turn a different node into a native route.
 */
export function resolveEmbedContentLink({
  href,
  currentHref,
  currentRoute,
  node,
}: {
  href: string;
  currentHref: string;
  currentRoute: string;
  /** Omitted on a fixed record/change-request preview: it has no reading routes. */
  node?: EmbedTargetNodeVO;
}): EmbedContentLink {
  const raw = href.trim();
  if (!raw) return { kind: "blocked" };
  if (raw.startsWith("#")) return { kind: "fragment", hash: raw };

  let url: URL;
  let current: URL;
  try {
    current = new URL(currentHref);
    url = new URL(raw, raw.startsWith("?") ? new URL(currentRoute, current.origin) : current);
  } catch {
    return { kind: "blocked" };
  }
  if (url.protocol === "mailto:" || url.protocol === "tel:") return { kind: "contact" };
  if (url.protocol === "blob:" && url.origin === current.origin) return { kind: "asset" };
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    return { kind: "blocked" };
  }
  if (url.origin !== current.origin) return { kind: "external", href: url.href };

  const route = `${url.pathname}${url.search}${url.hash}`;
  if (node && isEmbedNodeRoute(route, node)) {
    return { kind: "route", path: route };
  }
  if (url.pathname === current.pathname && url.search === current.search && url.hash) {
    return { kind: "fragment", hash: url.hash };
  }

  const linkId = /^\/embed\/([^/]+)(?:\/(?:node|record-detail|change-request))?$/.exec(
    current.pathname,
  )?.[1];
  const assetLinkId = /^\/embed\/([^/]+)\/assets\/[^/]+\/raw$/.exec(url.pathname)?.[1];
  if (linkId && assetLinkId === linkId) return { kind: "asset" };

  return { kind: "blocked" };
}
