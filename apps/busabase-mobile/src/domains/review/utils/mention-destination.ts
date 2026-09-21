/**
 * Where a mention row goes on the phone.
 *
 * `MentionInboxItemVO.href` is a DASHBOARD path — the web app's routes, not
 * this app's — so it cannot be handed to the router as-is. The server builds
 * exactly three shapes (`logic/mention-inbox.ts`'s `hrefFor`):
 *
 *   /inbox/{changeRequestId}/{operationId}  → an operation-scoped comment
 *   /inbox/{changeRequestId}                → a change-request comment
 *   /base/{baseSlug}/{recordId}             → a record comment
 *
 * plus `null` for a `commit`-scoped comment, which the dashboard has no page
 * for either.
 */
export type MentionDestination =
  | { kind: "change-request"; changeRequestId: string }
  | { kind: "operation"; changeRequestId: string; operationId: string }
  | { kind: "record"; recordId: string }
  /**
   * Nothing to open. The row is still rendered — see the contract's own note:
   * dropping it would be the one case where being mentioned silently never
   * reaches the person it was aimed at.
   */
  | { kind: "none" };

/**
 * Translate a dashboard href into a mobile destination.
 *
 * An unrecognised shape resolves to `none` rather than to a guess. The server
 * may grow a fourth shape before this app ships an update for it, and a row
 * that quietly opens the wrong screen is worse than one that opens nothing:
 * the reader would have no way to tell they were sent somewhere else.
 */
export const mentionDestination = (href: string | null | undefined): MentionDestination => {
  if (!href) return { kind: "none" };
  const segments = href.split("/").filter(Boolean);

  if (segments[0] === "inbox" && segments[1]) {
    return segments[2]
      ? { kind: "operation", changeRequestId: segments[1], operationId: segments[2] }
      : { kind: "change-request", changeRequestId: segments[1] };
  }
  // `/base/{baseSlug}/{recordId}` — the phone opens the record directly; it has
  // a record route and does not need the Base slug to reach it.
  if (segments[0] === "base" && segments[2]) {
    return { kind: "record", recordId: segments[2] };
  }
  return { kind: "none" };
};
