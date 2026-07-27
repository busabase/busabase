import type { CoreI18nMessages } from "../../../i18n";

export type InboxViewKey = "review" | "changes" | "created" | "approved" | "merged" | "rejected";

export const inboxTabLabel = (messages: CoreI18nMessages, key: InboxViewKey): string => {
  const labels: Record<InboxViewKey, string> = {
    approved: messages.inbox.approved,
    changes: messages.inbox.changesRequested,
    created: messages.inbox.created,
    merged: messages.inbox.merged,
    rejected: messages.inbox.closed,
    review: messages.inbox.forReview,
  };
  return labels[key];
};

export const getLocationPath = (location: string) => location.split("?")[0] || "/";

const INBOX_VIEW_KEYS: readonly InboxViewKey[] = [
  "review",
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
