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
