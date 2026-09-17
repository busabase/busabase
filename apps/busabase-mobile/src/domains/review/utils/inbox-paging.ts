import type { BusabaseORPCClient } from "busabase-contract/api-client/react-query";
import type {
  ChangeRequestCountsVO,
  ChangeRequestStatus,
  ChangeRequestVO,
} from "busabase-contract/types";
import { isMissingRouteError } from "~/api/mobile-api-compat";

export const INBOX_MODES = ["review", "mine", "done"] as const;
export type InboxMode = (typeof INBOX_MODES)[number];

export const INBOX_PAGE_SIZE = 50;

export interface InboxFilter {
  status?: ChangeRequestStatus[];
  mine?: boolean;
}

/**
 * What each tab asks the SERVER for.
 *
 * `mine` is the load-bearing one: it cannot be answered on this side. A change
 * request's `submittedBy` is whatever the server resolved the acting identity
 * to, and no id the client can see is reliably it — self-hosted `auth.verify()`
 * reports `local-user` while change requests are filed under `local-editor`,
 * and in the cloud the actor may be an agent or an API key rather than the
 * signed-in user. This screen used to compare `submittedBy` against a hardcoded
 * `["local-editor", "mobile-editor"]`, which left the Mine tab permanently
 * empty for every cloud user.
 *
 * The write side matters just as much: see `utils/submitted-by`. Asking the
 * server for `mine` only helps if the phone files change requests under the
 * same actor the server resolves that filter to — it used to file them under
 * `"mobile-editor"`, which no server ever answers `mine` with.
 *
 * Status goes to the server for a different reason: filtering it here can only
 * ever narrow one already-capped page, so a tab showed "what survived from the
 * first 100" while presenting itself as the whole queue.
 */
export const inboxModeFilter = (mode: InboxMode): InboxFilter => {
  switch (mode) {
    case "mine":
      return { mine: true };
    case "done":
      return { status: ["merged", "rejected"] };
    default:
      return { status: ["in_review", "approved"] };
  }
};

/**
 * One page of the inbox, from whichever route the server actually has.
 *
 * `snapshot` is one request for both the page and every tab's whole-space
 * count. `legacy` is the cursor listing every older server has: it pages just
 * as far, it simply cannot report counts.
 */
export type InboxPage =
  | {
      mode: "snapshot";
      changeRequests: ChangeRequestVO[];
      counts: ChangeRequestCountsVO;
      page: number;
      totalPages: number;
    }
  | { mode: "legacy"; changeRequests: ChangeRequestVO[]; nextCursor: string | null };

export type InboxPageParam = { kind: "page"; page: number } | { kind: "cursor"; cursor?: string };

export const FIRST_INBOX_PAGE: InboxPageParam = { kind: "page", page: 1 };

/**
 * The two change-request calls this screen needs.
 *
 * Declared structurally so a test can supply a plain object; the assertion
 * below is what keeps that from drifting away from the contract.
 */
export interface InboxClient {
  inboxSnapshot: (input: InboxFilter & { page: number; pageSize: number }) => Promise<{
    changeRequests: ChangeRequestVO[];
    counts: ChangeRequestCountsVO;
    page: number;
    totalPages: number;
  }>;
  list: (input: InboxFilter & { limit: number; cursor?: string }) => Promise<{
    changeRequests: ChangeRequestVO[];
    nextCursor?: string | null;
  }>;
}

/**
 * The real client must still satisfy that shape.
 *
 * Without this, the cast at the call site would absorb a renamed procedure or a
 * changed page payload silently, and the first sign of it would be an empty
 * Inbox on a user's phone rather than a failed build.
 */
type RealInboxClient = BusabaseORPCClient["changeRequests"];
type _InboxClientMatchesContract = RealInboxClient extends InboxClient ? true : never;
const _inboxClientMatchesContract: _InboxClientMatchesContract = true;

/**
 * Fetch one page, preferring the combined snapshot and degrading to the cursor
 * listing on a server that predates it.
 */
export const fetchInboxPage = async (
  client: InboxClient,
  filter: InboxFilter,
  pageParam: InboxPageParam,
): Promise<InboxPage> => {
  if (pageParam.kind === "page") {
    try {
      const snapshot = await client.inboxSnapshot({
        ...filter,
        page: pageParam.page,
        pageSize: INBOX_PAGE_SIZE,
      });
      return {
        mode: "snapshot",
        changeRequests: snapshot.changeRequests,
        counts: snapshot.counts,
        page: snapshot.page,
        totalPages: snapshot.totalPages,
      };
    } catch (caught) {
      // `inboxSnapshot` takes no id, so it cannot answer NOT_FOUND for missing
      // data — a not-found here can only mean this server predates the route.
      // Any other refusal (no access, a bad filter) is the server's real
      // answer and must reach the user rather than be retried on a route that
      // would refuse it identically.
      if (!isMissingRouteError(caught)) throw caught;
    }
  }

  const cursor = pageParam.kind === "cursor" ? pageParam.cursor : undefined;
  const page = await client.list({
    ...filter,
    limit: INBOX_PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
  });
  return {
    mode: "legacy",
    changeRequests: page.changeRequests,
    nextCursor: page.nextCursor ?? null,
  };
};

/** The next page to ask for, or undefined at the end of the list. */
export const nextInboxPageParam = (lastPage: InboxPage): InboxPageParam | undefined => {
  if (lastPage.mode === "snapshot") {
    return lastPage.page < lastPage.totalPages
      ? { kind: "page", page: lastPage.page + 1 }
      : undefined;
  }
  return lastPage.nextCursor ? { kind: "cursor", cursor: lastPage.nextCursor } : undefined;
};

/**
 * Tab badges, derived from the server's whole-space counts.
 *
 * `undefined` when the server cannot report them, which renders no badge at
 * all. A tab with no number reads as "not counted"; a number derived from the
 * rows in hand reads as the total and is wrong as soon as there are more change
 * requests than fit in one page — which is what the old screen displayed.
 */
export const inboxBadgeCounts = (pages: InboxPage[]): Record<InboxMode, number> | undefined => {
  const first = pages[0];
  if (first?.mode !== "snapshot") return undefined;
  const { counts } = first;
  return {
    review: counts.review + counts.approved,
    mine: counts.created,
    done: counts.merged + counts.rejected,
  };
};
