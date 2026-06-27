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

export const readInboxView = (search: string): InboxViewKey => {
  const view = new URLSearchParams(search).get("view");
  return view === "changes" ||
    view === "created" ||
    view === "approved" ||
    view === "merged" ||
    view === "rejected"
    ? view
    : "review";
};
