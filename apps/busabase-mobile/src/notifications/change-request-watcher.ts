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

const SEEN_KEY_PREFIX = "busabase-mobile.seen-change-requests.v1:";
const MAX_SEEN_IDS = 500;

/** expo-notifications native methods are unavailable on web; guard every call. */
export const NOTIFICATIONS_SUPPORTED = Platform.OS !== "web";

export async function fetchChangeRequests(
  serverUrl: string,
  headers: Record<string, string> = {},
): Promise<ChangeRequestVO[]> {
  const base = serverUrl.replace(/\/+$/, "");
  const client = createBusabaseORPCClient(`${base}/api/rpc`, { headers });
  const page = await client.changeRequests.list({ limit: 100 });
  return page.changeRequests;
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
  const changeRequests = await fetchChangeRequests(serverUrl, headers);
  await saveSeenIds(serverUrl, new Set(changeRequests.map((item) => item.id)), spaceId);
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
  spaceId?: string | null,
): Promise<WatchResult> {
  const changeRequests = await fetchChangeRequests(serverUrl, headers);
  const seen = await loadSeenIds(serverUrl, spaceId);
  const inReview = changeRequests.filter((item) => item.status === "in_review");
  const fresh = inReview.filter((item) => !seen.has(item.id));

  for (const changeRequest of changeRequests) {
    seen.add(changeRequest.id);
  }
  await saveSeenIds(serverUrl, seen, spaceId);
  await updateBadge(changeRequests);

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

  return { newCount: fresh.length, pendingCount: inReview.length };
}
