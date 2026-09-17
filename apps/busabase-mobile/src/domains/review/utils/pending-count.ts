import type { BusabaseORPCClient } from "busabase-contract/api-client/react-query";
import type { ChangeRequestCountsVO, ChangeRequestVO } from "busabase-contract/types";
import { selectPendingChangeRequests } from "busabase-core/dashboard/home";
import { isMissingRouteError } from "~/api/mobile-api-compat";

/**
 * How many rows a caller needs to PREVIEW, as opposed to count.
 *
 * Home shows four cards and the sidebar shows none, so nothing on either
 * surface needs the whole queue in memory — which is what made the old
 * `limit: 100` both wrong and wasteful.
 */
export const PENDING_PREVIEW_LIMIT = 20;

/** The two calls this needs, narrowed off the real client (see the assert below). */
export interface PendingCountClient {
  counts: (input: Record<string, never>) => Promise<ChangeRequestCountsVO>;
  list: (input: { limit: number }) => Promise<{ changeRequests: ChangeRequestVO[] }>;
}

/**
 * The real client must satisfy that shape — same guard as `inbox-paging`, so a
 * renamed procedure fails this build instead of the badge silently going blank
 * on someone's phone.
 */
type RealPendingClient = BusabaseORPCClient["changeRequests"];
type _PendingClientMatchesContract = RealPendingClient extends PendingCountClient ? true : never;
const _pendingClientMatchesContract: _PendingClientMatchesContract = true;

export interface PendingSnapshot {
  /**
   * How many change requests are waiting on this person, across the WHOLE
   * space — not just the ones that fit in a page.
   */
  count: number;
  /** The first few, for the preview cards. Never the basis for `count`. */
  preview: ChangeRequestVO[];
  /**
   * True when `count` came from counting rows in hand rather than from the
   * server. Callers that render a badge should prefer to show nothing over a
   * number they know is capped.
   */
  capped: boolean;
}

/**
 * The whole-space `in_review` count, or null when this server cannot answer it.
 *
 * Null rather than a guess: every caller here renders the number as a total —
 * a screen badge, or the app icon badge on a home screen — and a page size
 * presented as a total is the defect this exists to remove. A caller that gets
 * null decides for itself whether to fall back or show nothing.
 */
export const fetchPendingCountOrNull = async (
  client: Pick<PendingCountClient, "counts">,
): Promise<number | null> => {
  try {
    // `counts.review` is exactly `selectPendingChangeRequests`' definition —
    // strictly `in_review`, excluding `approved` requests that are already
    // decided and only awaiting a merge. A badge that counted `approved` would
    // say a decision is needed when none is.
    return (await client.counts({})).review;
  } catch (caught) {
    // `counts` takes no id, so it cannot answer NOT_FOUND for missing data — a
    // not-found here can only mean this server predates the route.
    if (!isMissingRouteError(caught)) throw caught;
    return null;
  }
};

/**
 * Home's badge and the sidebar's badge, answered by the server.
 *
 * `counts.review` is exactly `selectPendingChangeRequests`' definition —
 * strictly `in_review`, excluding `approved` requests that are already decided
 * and only awaiting a merge. The two must not drift: a badge that counts
 * `approved` says a decision is needed when none is.
 *
 * Both surfaces used to fetch a page (`limit: 100` on Home, the default 50 in
 * the sidebar) and count what came back, so a space with more change requests
 * than the page held reported the page size as the total — Home said "100
 * pending" and the sidebar said "50" against a real 116.
 */
export const fetchPendingSnapshot = async (
  client: PendingCountClient,
): Promise<PendingSnapshot> => {
  const page = await client.list({ limit: PENDING_PREVIEW_LIMIT });
  const preview = selectPendingChangeRequests(page.changeRequests);
  const serverCount = await fetchPendingCountOrNull(client);

  if (serverCount !== null) return { count: serverCount, preview, capped: false };
  // Fall back to counting the page, and SAY that it is capped so a caller can
  // decline to render a number it cannot stand behind.
  return {
    count: preview.length,
    preview,
    capped: page.changeRequests.length >= PENDING_PREVIEW_LIMIT,
  };
};
