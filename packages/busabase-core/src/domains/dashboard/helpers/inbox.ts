import type { ChangeRequestStatus } from "busabase-contract/types";
import type { CoreI18nMessages } from "../../../i18n";

export type InboxViewKey =
  | "review"
  | "mentions"
  | "changes"
  | "created"
  | "approved"
  | "merged"
  | "rejected";

export const inboxTabLabel = (messages: CoreI18nMessages, key: InboxViewKey): string => {
  const labels: Record<InboxViewKey, string> = {
    approved: messages.inbox.approved,
    changes: messages.inbox.changesRequested,
    created: messages.inbox.created,
    merged: messages.inbox.merged,
    rejected: messages.inbox.closed,
    mentions: messages.inbox.mentions,
    review: messages.inbox.forReview,
  };
  return labels[key];
};

export const inboxTabFilter = (
  tab: InboxViewKey,
): { status?: ChangeRequestStatus[]; mine?: boolean } => {
  switch (tab) {
    case "changes":
      return { status: ["changes_requested"] };
    case "created":
      return { mine: true };
    case "approved":
      return { status: ["approved"] };
    case "merged":
      return { status: ["merged"] };
    case "rejected":
      return { status: ["rejected", "abandoned"] };
    default:
      return { status: ["in_review"] };
  }
};

export const getLocationPath = (location: string) => location.split("?")[0] || "/";

/**
 * Every Inbox tab, in display order — and the ONLY list of them.
 *
 * The toolbar used to keep its own hardcoded copy, which is why adding a key
 * here once shipped a tab that the URL accepted but no one could click. One
 * array, read by both the router-ish `readInboxView` and the tab bar.
 */
export const INBOX_VIEW_KEYS: readonly InboxViewKey[] = [
  "review",
  // Right after "for review": both answer "what is waiting on me", which is
  // what the Inbox is for. The CR-shaped tabs that follow are about a change
  // request's lifecycle, not about the reader.
  "mentions",
  "changes",
  "created",
  "approved",
  "merged",
  "rejected",
];

const isInboxViewKey = (value: string | null): value is InboxViewKey =>
  value !== null && (INBOX_VIEW_KEYS as readonly string[]).includes(value);

/**
 * `view=review` is now written out explicitly by the tab bar rather than being
 * implied by a bare `/inbox` — see the `href` comment in `BusabaseListToolbar`
 * for why the bare form could not navigate back. An absent or unrecognized
 * `view` still resolves to "review", so old bookmarks of plain `/inbox` keep
 * working.
 */
export const readInboxView = (search: string): InboxViewKey => {
  const view = new URLSearchParams(search).get("view");
  return isInboxViewKey(view) ? view : "review";
};

export const INBOX_PAGE_SIZES = [25, 50, 100] as const;
export type InboxPageSize = (typeof INBOX_PAGE_SIZES)[number];
export interface InboxQueueContext {
  view: InboxViewKey;
  page: number;
  pageSize: InboxPageSize;
}

export const readInboxQueueContext = (search: string): InboxQueueContext | null => {
  const params = new URLSearchParams(search);
  const page = Number(params.get("inboxPage"));
  const pageSize = Number(params.get("inboxPageSize"));
  const view = params.get("view");
  if (
    !isInboxViewKey(view) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !INBOX_PAGE_SIZES.includes(pageSize as InboxPageSize)
  ) {
    return null;
  }
  return { view, page, pageSize: pageSize as InboxPageSize };
};

export const writeInboxQueueContext = (search: string, context: InboxQueueContext): string => {
  const params = new URLSearchParams(search);
  params.set("view", context.view);
  params.set("inboxPage", String(context.page));
  params.set("inboxPageSize", String(context.pageSize));
  params.delete("inboxItem");
  return params.toString();
};

export const inboxNeighborPage = (
  ids: readonly string[],
  currentId: string,
  direction: "previous" | "next",
  page: number,
  totalPages: number,
): { id: string; page: number } | { page: number } | null => {
  const index = ids.indexOf(currentId);
  if (index < 0) return null;
  const neighbor = ids[index + (direction === "next" ? 1 : -1)];
  if (neighbor) return { id: neighbor, page };
  const adjacentPage = page + (direction === "next" ? 1 : -1);
  if (adjacentPage < 1 || adjacentPage > totalPages) return null;
  return { page: adjacentPage };
};
