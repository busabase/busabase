import type { ChangeRequestStatus, ChangeRequestVO } from "busabase-contract/types";

/**
 * Platform-neutral rules behind the Home landing digest, shared by the web
 * dashboard (`components/home.tsx`) and `apps/busabase-mobile`'s Home screen.
 *
 * Deliberately contains NO rendering and no route strings — the two platforms
 * disagree on both (Tailwind/`SPALink` vs React Native/expo-router), but they
 * must agree on *what counts as pending* and *how much of each section is a
 * preview*, or the two Homes silently drift apart.
 */

/**
 * How many rows each Home section previews before deferring to its full screen.
 * Home is a "where do I pick up?" digest, not a third copy of Inbox/Activity.
 */
export const HOME_PENDING_PREVIEW_COUNT = 4;
export const HOME_RECENT_PREVIEW_COUNT = 8;
export const HOME_ACTIVITY_PREVIEW_COUNT = 6;
/** Preview cap for the "Recently used Apps" gallery — smaller than the plain
 * recent-nodes list since each tile is a large icon card, not a text row. */
export const HOME_RECENT_APPS_PREVIEW_COUNT = 6;

/**
 * The change requests Home counts as "waiting for you".
 *
 * Strictly `in_review` — NOT the wider set mobile's Inbox tab calls "review"
 * (which also includes `approved`, i.e. already-decided requests awaiting a
 * merge). Home's badge and card answer "what still needs a decision from me",
 * so an approved request must not inflate it.
 */
export const selectPendingChangeRequests = (
  changeRequests: readonly ChangeRequestVO[],
): ChangeRequestVO[] =>
  changeRequests.filter((changeRequest) => changeRequest.status === "in_review");

/**
 * The `changeRequests.list` input behind Home's "waiting for your review"
 * preview: only `in_review`, only as many rows as the preview shows. The total
 * comes from `changeRequests.reviewCount` (`review`), never from this page.
 *
 * Shared so every Home asks the same question, including a server render that
 * seeds it. Home used to ask for the newest 50 change requests of any status,
 * with every operation, and filter them locally. That downloaded 455KB of
 * merged requests to show "nothing waiting" in a busy space, and it missed a
 * request still in review once 50 newer ones had landed.
 */
export const homePendingListInput = (): { status: ChangeRequestStatus[]; limit: number } => ({
  status: ["in_review"],
  limit: HOME_PENDING_PREVIEW_COUNT,
});

/**
 * Whether Home has nothing at all to show and should hand over to the
 * onboarding guide. Callers must pass `isActivityLoaded: false` while the
 * activity request is still in flight, so a slow first load never flashes the
 * "you have nothing" state at a returning user.
 */
export const isHomeDigestEmpty = ({
  activityCount,
  isActivityLoaded,
  isChangeRequestsLoaded = true,
  pendingCount,
  recentCount,
}: {
  activityCount: number;
  isActivityLoaded: boolean;
  isChangeRequestsLoaded?: boolean;
  pendingCount: number;
  recentCount: number;
}): boolean =>
  isActivityLoaded &&
  isChangeRequestsLoaded &&
  pendingCount === 0 &&
  recentCount === 0 &&
  activityCount === 0;
