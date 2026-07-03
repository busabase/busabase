import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChangeRequestVO } from "busabase-contract/types";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  getChangeRequestScopeName,
  getOperationSummary,
  getPrimaryTitle,
} from "~/lib/busabase-display";

const SEEN_KEY_PREFIX = "busabase-mobile.seen-change-requests.v1:";
const MAX_SEEN_IDS = 500;

/** expo-notifications native methods are unavailable on web; guard every call. */
export const NOTIFICATIONS_SUPPORTED = Platform.OS !== "web";

/**
 * Fetches change requests over the plain REST endpoint so the watcher also
 * works inside background tasks where the oRPC client setup is unnecessary.
 */
export async function fetchChangeRequests(
  serverUrl: string,
  headers: Record<string, string> = {},
): Promise<ChangeRequestVO[]> {
  const base = serverUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/api/v1/change-requests?limit=100`, {
    headers: { Accept: "application/json", ...headers },
  });
  if (!response.ok) {
    throw new Error(`Server responded ${response.status}`);
  }
  return (await response.json()) as ChangeRequestVO[];
}

async function loadSeenIds(serverUrl: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY_PREFIX + serverUrl);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

async function saveSeenIds(serverUrl: string, ids: Set<string>): Promise<void> {
  await AsyncStorage.setItem(
    SEEN_KEY_PREFIX + serverUrl,
    JSON.stringify([...ids].slice(-MAX_SEEN_IDS)),
  );
}

export async function markChangeRequestSeen(serverUrl: string, id: string): Promise<void> {
  const seen = await loadSeenIds(serverUrl);
  if (!seen.has(id)) {
    seen.add(id);
    await saveSeenIds(serverUrl, seen);
  }
}

/** Seeds the seen set without notifying — used right after notifications are enabled. */
export async function primeSeenChangeRequests(
  serverUrl: string,
  headers: Record<string, string> = {},
): Promise<void> {
  const changeRequests = await fetchChangeRequests(serverUrl, headers);
  await saveSeenIds(serverUrl, new Set(changeRequests.map((item) => item.id)));
  await updateBadge(changeRequests);
}

async function updateBadge(changeRequests: ChangeRequestVO[]): Promise<void> {
  if (!NOTIFICATIONS_SUPPORTED) {
    return;
  }
  const pending = changeRequests.filter((item) => item.status === "in_review").length;
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
): Promise<WatchResult> {
  const changeRequests = await fetchChangeRequests(serverUrl, headers);
  const seen = await loadSeenIds(serverUrl);
  const inReview = changeRequests.filter((item) => item.status === "in_review");
  const fresh = inReview.filter((item) => !seen.has(item.id));

  for (const changeRequest of changeRequests) {
    seen.add(changeRequest.id);
  }
  await saveSeenIds(serverUrl, seen);
  await updateBadge(changeRequests);

  if (NOTIFICATIONS_SUPPORTED) {
    for (const changeRequest of fresh) {
      const title = getPrimaryTitle(
        changeRequest.primaryOperation?.headCommit.fields ?? {},
        `Change Request ${changeRequest.id.slice(0, 8)}`,
      );
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `New change request: ${title}`,
          body: `${getChangeRequestScopeName(changeRequest)} · ${getOperationSummary(changeRequest)} · from ${changeRequest.submittedBy}`,
          data: { changeRequestId: changeRequest.id },
          sound: "default",
        },
        trigger: null,
      });
    }
  }

  return { newCount: fresh.length, pendingCount: inReview.length };
}
