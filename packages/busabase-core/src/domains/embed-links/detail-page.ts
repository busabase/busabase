import "server-only";

import {
  decodeEmbedCapability,
  embedCapabilityCookieName,
  isValidEmbedPublicId,
  parseEmbedIframeCapability,
} from "./capability";
import {
  resolveAirAppEmbedRuntime,
  resolveEmbedLink,
  resolveExpiredAirAppEmbedLink,
  resolveExpiredEmbedLink,
} from "./logic";
import type { AirAppEmbedRuntimeVO, ResolvedPolymorphicEmbedVO } from "./types";

export type EmbedDetailType = "change-request" | "record-detail";

export type ResolvedEmbedDetail<T extends EmbedDetailType> = Extract<
  ResolvedPolymorphicEmbedVO,
  { type: T }
>;

export interface LoadEmbedDetailInput<T extends EmbedDetailType> {
  publicId: string;
  /** `?token=` — an iframe passes its capability directly. */
  token?: string;
  /** Raw value of this link's capability cookie, if the host found one. */
  cookieValue?: string;
  /** Which target this route renders; anything else is a 404 for this page. */
  expect: T;
  withHostContext?: <R>(fn: () => Promise<R>) => Promise<R>;
}

/**
 * Everything the typed detail pages do before they render, minus the framework.
 *
 * The four pages (two targets × two hosts) were four copies of this: validate
 * the public id, take the token or fall back to the cookie, resolve, then
 * narrow to the type the route is for. What legitimately differs between hosts
 * is only how they read cookies, whether they wrap in a host context, and what
 * they render — so those stay outside, and this stays free of `next/*` (this
 * package also backs the CLI, SDK and mobile clients).
 *
 * Returns `{ expired: true }` when the holder of a real secret arrives after
 * the link ran out, and null for every other failure — "bad id" and "revoked
 * link" must look the same to a visitor.
 */
export const loadEmbedDetail = async <T extends EmbedDetailType>({
  publicId,
  token,
  cookieValue,
  expect,
  withHostContext = (fn) => fn(),
}: LoadEmbedDetailInput<T>): Promise<
  { embed: ResolvedEmbedDetail<T>; secret: string } | { expired: true } | null
> => {
  if (!isValidEmbedPublicId(publicId)) return null;
  const cookie = decodeEmbedCapability(cookieValue);
  const secret = token ?? (cookie?.id === publicId ? cookie.secret : "");
  if (!secret) return null;

  const embed = await withHostContext(() => resolveEmbedLink(publicId, secret));
  if (!embed) {
    const expired = await withHostContext(() => resolveExpiredEmbedLink(publicId, secret));
    // A link opened on the wrong target's page is "unavailable" whether or not it expired.
    return expired?.type === expect ? { expired: true } : null;
  }
  if (embed.type !== expect) return null;
  return { embed: embed as ResolvedEmbedDetail<T>, secret };
};

export interface LoadAirAppEmbedInput {
  publicId: string;
  token?: string;
  view?: string;
  cookieValue?: string;
  withHostContext?: <R>(fn: () => Promise<R>) => Promise<R>;
}

/**
 * The AirApp embed page's pre-render half, shared by both hosts.
 *
 * Same shape as `loadEmbedDetail`, with the one wrinkle this target has: an
 * AirApp with no readable files cannot boot, so it is treated as unavailable
 * here rather than handing the runtime an empty bundle to spin on. A link
 * whose time ran out comes back as `{ expired: true }` so the page can say so.
 */
export const loadAirAppEmbedRuntime = async ({
  publicId,
  token,
  view,
  cookieValue,
  withHostContext = (fn) => fn(),
}: LoadAirAppEmbedInput): Promise<
  { runtime: AirAppEmbedRuntimeVO; secret: string } | { expired: true } | null
> => {
  if (!isValidEmbedPublicId(publicId)) return null;
  const direct = parseEmbedIframeCapability(
    `/embed/${publicId}/airapp`,
    token ?? null,
    view ?? null,
  );
  const cookie = decodeEmbedCapability(cookieValue);
  const capability = direct ?? (cookie?.id === publicId ? cookie : null);
  if (!capability) return null;

  const runtime = await withHostContext(() =>
    resolveAirAppEmbedRuntime(publicId, capability.secret),
  );
  if (!runtime) {
    const expired = await withHostContext(() =>
      resolveExpiredAirAppEmbedLink(publicId, capability.secret),
    );
    return expired ? { expired: true } : null;
  }
  if (Object.keys(runtime.files).length === 0) return null;
  return { runtime, secret: capability.secret };
};

export { embedCapabilityCookieName };
