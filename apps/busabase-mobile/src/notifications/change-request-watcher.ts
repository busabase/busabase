import AsyncStorage from "@react-native-async-storage/async-storage";
import { createBusabaseORPCClient } from "busabase-contract/api-client/react-query";
import type { ChangeRequestVO } from "busabase-contract/types";
import {
  getChangeRequestScopeName,
  getChangeRequestSummary,
} from "busabase-core/dashboard/change-request";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { getPrimaryTitle } from "~/domains/review/utils/busabase-display";
import {
  fetchPendingCountOrNull,
  type PendingCountClient,
} from "~/domains/review/utils/pending-count";

const SEEN_KEY_PREFIX = "busabase-mobile.seen-change-requests.v1:";
const MAX_SEEN_IDS = 500;

/** expo-notifications native methods are unavailable on web; guard every call. */
export const NOTIFICATIONS_SUPPORTED = Platform.OS !== "web";

/**
 * How far back the watcher looks for change requests it has not announced yet.
 *
 * A window, not a total: `changeRequests.list` is newest-first, so anything new
 * since the last poll is inside it. The BADGE must not be computed from this
 * window — see `fetchWatchState`.
 */
const WATCH_WINDOW = 100;

interface WatchState {
  changeRequests: ChangeRequestVO[];
  /**
   * Whole-space `in_review` count from the server, or null on a server too old
   * to answer it.
   */
  pendingCount: number | null;
}

/**
 * The window of recent change requests, plus the real pending total.
 *
 * Two separate answers on purpose. The badge on the app icon is the first
 * number a person sees all day, and it used to be
 * `recentWindow.filter(in_review).length` — which silently stopped at the
 * window size, reporting 100 for a space holding any number above it. The
 * window is still right for deciding what to NOTIFY about (it is newest-first,
 * so nothing new can fall outside it); it was never right for a total.
 */
async function fetchWatchState(
  serverUrl: string,
  headers: Record<string, string> = {},
): Promise<WatchState> {
  const base = serverUrl.replace(/\/+$/, "");
  const client = createBusabaseORPCClient(`${base}/api/rpc`, { headers });
  const [page, pendingCount] = await Promise.all([
    client.changeRequests.list({ limit: WATCH_WINDOW }),
    fetchPendingCountOrNull(client.changeRequests as unknown as PendingCountClient),
  ]);
  return { changeRequests: page.changeRequests, pendingCount };
}

export async function fetchChangeRequests(
  serverUrl: string,
  headers: Record<string, string> = {},
): Promise<ChangeRequestVO[]> {
  return (await fetchWatchState(serverUrl, headers)).changeRequests;
}

const scopeKey = (serverUrl: string, spaceId?: string | null) =>
  `${serverUrl}${spaceId ? `#${spaceId}` : ""}`;

async function loadSeenIds(serverUrl: string, spaceId?: string | null): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY_PREFIX + scopeKey(serverUrl, spaceId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

async function saveSeenIds(
  serverUrl: string,
  ids: Set<string>,
  spaceId?: string | null,
): Promise<void> {
  await AsyncStorage.setItem(
    SEEN_KEY_PREFIX + scopeKey(serverUrl, spaceId),
    JSON.stringify([...ids].slice(-MAX_SEEN_IDS)),
  );
}

export async function markChangeRequestSeen(
  serverUrl: string,
  id: string,
  spaceId?: string | null,
): Promise<void> {
  const seen = await loadSeenIds(serverUrl, spaceId);
  if (!seen.has(id)) {
    seen.add(id);
    await saveSeenIds(serverUrl, seen, spaceId);
  }
}

/** Seeds the seen set without notifying — used right after notifications are enabled. */
export async function primeSeenChangeRequests(
  serverUrl: string,
  headers: Record<string, string> = {},
  spaceId?: string | null,
): Promise<void> {
  const { changeRequests, pendingCount } = await fetchWatchState(serverUrl, headers);
  await saveSeenIds(serverUrl, new Set(changeRequests.map((item) => item.id)), spaceId);
  await updateBadge(changeRequests, pendingCount);
}

async function updateBadge(
  changeRequests: ChangeRequestVO[],
  pendingCount: number | null,
): Promise<void> {
  if (!NOTIFICATIONS_SUPPORTED) {
    return;
  }
  // Prefer the server's whole-space count. Counting the window is the old
  // behaviour, kept only for servers that cannot answer `counts` — there it is
  // still capped, but it is the best number available and a stale badge beats
  // no badge on a home screen.
  const pending =
    pendingCount ?? changeRequests.filter((item) => item.status === "in_review").length;
  try {
    await Notifications.setBadgeCountAsync(pending);
  } catch {
    // Badges are unsupported on some platforms (e.g. web); ignore.
  }
}

export interface WatchResult {
  newCount: number;
  pendingCount: number;
}

/**
 * Core polling step shared by foreground polling and the background task:
 * fetch change requests, diff the in_review set against persisted seen ids,
 * fire one local notification per new change request, and update the badge.
 */
export async function checkForNewChangeRequests(
  serverUrl: string,
  headers: Record<string, string> = {},
  spaceId?: string | null,
): Promise<WatchResult> {
  const { changeRequests, pendingCount } = await fetchWatchState(serverUrl, headers);
  const seen = await loadSeenIds(serverUrl, spaceId);
  const inReview = changeRequests.filter((item) => item.status === "in_review");
  const fresh = inReview.filter((item) => !seen.has(item.id));

  for (const changeRequest of changeRequests) {
    seen.add(changeRequest.id);
  }
  await saveSeenIds(serverUrl, seen, spaceId);
  await updateBadge(changeRequests, pendingCount);

  if (NOTIFICATIONS_SUPPORTED) {
    for (const changeRequest of fresh) {
      const title = getPrimaryTitle(
        changeRequest.primaryOperation?.headCommit.payload ?? {},
        `Change Request ${changeRequest.id.slice(0, 8)}`,
      );
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `New change request: ${title}`,
          body: `${getChangeRequestScopeName(changeRequest)} · ${getChangeRequestSummary(changeRequest)} · from ${changeRequest.submittedBy}`,
          data: { changeRequestId: changeRequest.id },
          sound: "default",
        },
        trigger: null,
      });
    }
  }

  // The caller's `pendingCount` is the same number the badge shows, for the
  // same reason: it is a total, not a count of the window that was scanned.
  return { newCount: fresh.length, pendingCount: pendingCount ?? inReview.length };
}
