// Shared dashboard string catalog — the "sub" i18n strings owned by busabase-core
// and reused by every host (apps/busabase, apps/busabase-cloud).
//
// `coreMessagesEn` is the source of truth; every other locale must match its shape
// (enforced by the `CoreI18nMessages` type). Strings use `{token}` placeholders
// so they stay compatible with the apps' typesafe-i18n catalogs that import them,
// and so busabase-core's own runtime accessor (`fmt`) can interpolate them.

export const coreMessagesEn = {
  common: {
    open: "Open",
    loading: "Loading…",
    noFields: "No fields",
    yes: "Yes",
    no: "No",
  },
  nav: {
    inbox: "Inbox",
    search: "Search",
    activity: "Activity",
    bases: "Bases",
    new: "New",
  },
  inbox: {
    title: "Reviews",
    forReview: "For review",
    changesRequested: "Changes requested",
    created: "Created",
    approved: "Approved",
    merged: "Merged",
    closed: "Closed",
    empty: "{label} is clear",
    emptyBody: "Change requests will appear here when the review workflow reaches this state.",
    openChangeRequests: "Open change requests",
    closedChangeRequests: "Closed change requests",
  },
  review: {
    whatWillChange: "What will change",
    noFieldChanges: "No field changes in this operation.",
    commentsOnThisChange: "Comments on this change",
    changedSinceReview: "changed since review",
    discussion: "Discussion",
    finishReview: "Finish review",
    approve: "Approve",
    requestChanges: "Request changes",
    submitReview: "Submit review",
    closeChangeRequest: "Close change request",
    changesRequestedBanner:
      "You requested changes — the agent revises, then it returns here for re-review.",
    approveNotePlaceholder: "Add an optional note…",
    requestChangesPlaceholder: "What needs to change? (required — mention @ai to ask the agent)",
    mergeIntoBase: "Merge into Base",
    requestedChanges: "requested changes",
    approvedChangeRequest: "approved this change request",
    statusPanel: "Status",
    reviewPanel: "Review",
    submittedBy: "Submitted by",
    created: "Created",
    updated: "Updated",
    waitingForReview: "Waiting for your review",
    approvedReadyToMerge: "Approved · ready to merge",
    changesRequestedAwaiting: "Changes requested · awaiting revision",
    mergedIntoBase: "Merged into Base",
    statusClosed: "Closed",
  },
  status: {
    inReview: "In review",
    changesRequested: "Changes requested",
    closed: "Closed",
  },
  comments: {
    placeholder: "Add a comment… mention @ai to request an agent revision",
    placeholderOperation: "Comment on this change… mention @ai to request a revision",
    placeholderDiscussion: "Leave a comment for the author… mention @ai to request a revision",
    comment: "Comment",
    posting: "Posting…",
    quoteReply: "Quote reply",
    quotedAttribution: "@{author} wrote:",
    noComments: "No comments yet.",
    noCommentsOperation: "No comments on this change yet.",
    noCommentsDiscussion: "No comments yet. Leave feedback for the author or @ai.",
    loading: "Loading comments…",
    failed: "Failed to add comment",
    agentWillRevise: "The agent will be asked to revise.",
    mentionHint: "Mention @ai to request a revision.",
  },
};

export type CoreI18nMessages = typeof coreMessagesEn;
