"use client";

/**
 * The Space Selector's order: the spaces this person made active most recently
 * come first, the rest keep the host's order (usually newest membership first).
 *
 * Recency is kept in the browser, not the database. It only orders a list the
 * server already authorized, so it never decides access, and keeping it here
 * spares every app's shared `members` table a column. The cost: a browser that
 * has not been used yet starts from the host's order.
 */

import * as React from "react";
import type { Space } from "./types";

/**
 * How many recently active spaces a browser remembers; the rest keep the host's
 * order. Small because the cookie variant rides on every request.
 */
export const RECENT_SPACES_LIMIT = 10;

const RECENT_SPACES_STORAGE_KEY = "openlib:recent-space-ids";

/** `recentSpaceIds` with `spaceId` moved to the front, deduplicated and bounded. */
export const rememberRecentSpace = (
  recentSpaceIds: readonly string[],
  spaceId: string,
  limit = RECENT_SPACES_LIMIT,
): string[] => [spaceId, ...recentSpaceIds.filter((id) => id !== spaceId)].slice(0, limit);

/**
 * `spaces` with the recently active ones first, most recent first. Spaces not in
 * `recentSpaceIds` follow in the order they came in; ids of spaces that are not
 * in `spaces` (left or deleted since) are ignored.
 */
export const orderSpacesByRecent = <T extends Pick<Space, "id">>(
  spaces: readonly T[],
  recentSpaceIds: readonly string[],
): T[] => {
  if (recentSpaceIds.length === 0) return [...spaces];
  const rankById = new Map(recentSpaceIds.map((id, index) => [id, index]));
  const unranked = recentSpaceIds.length;
  return spaces
    .map((space, index) => ({
      space,
      index,
      rank: (space.id ? rankById.get(space.id) : undefined) ?? unranked,
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.space);
};

const RecentSpaceIdsContext = React.createContext<readonly string[] | null>(null);

/**
 * For a host that keeps its own recency record, typically because its
 * workspaces each live on their own subdomain, where `localStorage` would split
 * into one history per host (see `useCookieRecentSpaceIds`). Space Selectors
 * inside read these ids and leave `localStorage` alone.
 */
export const RecentSpaceIdsProvider = RecentSpaceIdsContext.Provider;

const toRecentSpaceIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((id): id is string => typeof id === "string" && id.length > 0)
        .slice(0, RECENT_SPACES_LIMIT)
    : [];

export const readStoredRecentSpaceIds = (): string[] => {
  try {
    return toRecentSpaceIds(
      JSON.parse(window.localStorage.getItem(RECENT_SPACES_STORAGE_KEY) ?? "[]"),
    );
  } catch {
    return [];
  }
};

const writeStoredRecentSpaceIds = (recentSpaceIds: readonly string[]) => {
  try {
    window.localStorage.setItem(RECENT_SPACES_STORAGE_KEY, JSON.stringify(recentSpaceIds));
  } catch {
    // Storage blocked or full: the list keeps the host's order.
  }
};

/**
 * Recent space ids, most recent first: the host's (`RecentSpaceIdsProvider`)
 * when it has some, otherwise this browser's, where `activeSpaceId` is recorded
 * every time it changes.
 */
export function useRecentSpaceIds(activeSpaceId: string | undefined): readonly string[] {
  const hostRecentSpaceIds = React.useContext(RecentSpaceIdsContext);
  const ownsHistory = hostRecentSpaceIds === null;
  const [storedRecentSpaceIds, setStoredRecentSpaceIds] = React.useState<readonly string[]>([]);

  React.useEffect(() => {
    if (!ownsHistory) return;
    const stored = readStoredRecentSpaceIds();
    if (!activeSpaceId) {
      setStoredRecentSpaceIds(stored);
      return;
    }
    const next = rememberRecentSpace(stored, activeSpaceId);
    writeStoredRecentSpaceIds(next);
    setStoredRecentSpaceIds(next);
  }, [ownsHistory, activeSpaceId]);

  return hostRecentSpaceIds ?? storedRecentSpaceIds;
}

const readCookieRecentSpaceIds = (cookieName: string, userId: string): string[] => {
  const prefix = `${cookieName}=`;
  const raw = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length);
  if (!raw) return [];
  try {
    const parsed: { userId?: unknown; spaceIds?: unknown } | null = JSON.parse(
      decodeURIComponent(raw),
    );
    return parsed?.userId === userId ? toRecentSpaceIds(parsed.spaceIds) : [];
  } catch {
    return [];
  }
};

const writeCookieRecentSpaceIds = (
  cookieName: string,
  cookieDomain: string | undefined,
  userId: string,
  spaceIds: readonly string[],
) => {
  const host = cookieDomain?.split(":")[0]?.trim();
  // Browsers refuse `Domain=localhost` and IP addresses; those keep a host-only cookie.
  const domain =
    host && host !== "localhost" && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)
      ? `; domain=.${host}`
      : "";
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  const value = encodeURIComponent(JSON.stringify({ userId, spaceIds }));
  // biome-ignore lint/suspicious/noDocumentCookie: a bounded, non-secret ordering hint every workspace subdomain reads
  document.cookie = `${cookieName}=${value}; path=/; max-age=31536000; samesite=lax${domain}${secure}`;
};

/**
 * The same history kept in a cookie on `.<cookieDomain>` instead of
 * `localStorage`, for hosts whose workspaces each live on their own subdomain:
 * switching space changes host there, and `localStorage` belongs to one host,
 * so every switch would start a new history. Hand the result to
 * `RecentSpaceIdsProvider`. Scoped to `userId`, so another account signed in to
 * the same browser keeps its own; nothing is recorded without one.
 */
export function useCookieRecentSpaceIds({
  cookieName,
  cookieDomain,
  userId,
  activeSpaceId,
}: {
  cookieName: string;
  /** The workspace base domain (`buda.im`, `lvh.me:3000`). Without one the cookie stays on this host. */
  cookieDomain?: string;
  userId: string | undefined;
  activeSpaceId: string | undefined;
}): readonly string[] {
  const [recentSpaceIds, setRecentSpaceIds] = React.useState<readonly string[]>([]);

  React.useEffect(() => {
    if (!userId) return;
    const stored = readCookieRecentSpaceIds(cookieName, userId);
    if (!activeSpaceId) {
      setRecentSpaceIds(stored);
      return;
    }
    const next = rememberRecentSpace(stored, activeSpaceId);
    writeCookieRecentSpaceIds(cookieName, cookieDomain, userId, next);
    setRecentSpaceIds(next);
  }, [cookieName, cookieDomain, userId, activeSpaceId]);

  return recentSpaceIds;
}

/**
 * The ids this browser kept in `localStorage` before the account kept them.
 * Read after mount (it differs from the server render), `[]` until then. Pass
 * to `useAccountRecentSpaceIds` as the seed for an account with no list yet.
 */
export function useStoredRecentSpaceIds(): readonly string[] {
  const [stored, setStored] = React.useState<readonly string[]>([]);
  React.useEffect(() => {
    setStored(readStoredRecentSpaceIds());
  }, []);
  return stored;
}

/**
 * Recently entered spaces kept on the account, so every device lists them in
 * the same order. The host fetches the account's list and records visits
 * (transport stays the host's); this does the rest: records the active space
 * when it changes, keeps the latest list the server returned, and falls back to
 * the browser-kept history (`seedRecentSpaceIds`) for an account with none yet,
 * which is also sent along so that history is not lost. Hand the result to
 * `RecentSpaceIdsProvider`.
 *
 * It only orders spaces already authorized: a failed record changes nothing but
 * the order.
 */
export function useAccountRecentSpaceIds({
  activeSpaceId,
  enabled,
  accountRecentSpaceIds,
  recordVisit,
  seedRecentSpaceIds,
}: {
  activeSpaceId: string | undefined;
  /** False without a signed-in user (demo): nothing is recorded or shown from the account. */
  enabled: boolean;
  /** The account's list as the host fetched it; undefined while loading. */
  accountRecentSpaceIds: readonly string[] | undefined;
  /** Records a visit on the server and resolves to the account's list. */
  recordVisit: (input: { id: string; seedRecentSpaceIds: string[] }) => Promise<readonly string[]>;
  seedRecentSpaceIds: readonly string[];
}): readonly string[] {
  const [visited, setVisited] = React.useState<readonly string[] | null>(null);
  const recordVisitRef = React.useRef(recordVisit);
  recordVisitRef.current = recordVisit;
  const seedRef = React.useRef(seedRecentSpaceIds);
  seedRef.current = seedRecentSpaceIds;

  React.useEffect(() => {
    if (!enabled || !activeSpaceId) return;
    let cancelled = false;
    recordVisitRef
      .current({ id: activeSpaceId, seedRecentSpaceIds: [...seedRef.current] })
      .then((recentSpaceIds) => {
        if (!cancelled) setVisited(recentSpaceIds);
      })
      .catch(() => {
        // Order only: the list stays as it was.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, activeSpaceId]);

  // The seed list's contents, so an array rebuilt on every render does not
  // rebuild the result.
  const seedKey = JSON.stringify(seedRecentSpaceIds);
  return React.useMemo(() => {
    const account = enabled ? (visited ?? accountRecentSpaceIds) : undefined;
    const known = account && account.length > 0 ? account : (JSON.parse(seedKey) as string[]);
    // The space on screen is the most recent one, before the server has said so.
    return enabled && activeSpaceId ? rememberRecentSpace(known, activeSpaceId) : known;
  }, [enabled, visited, accountRecentSpaceIds, activeSpaceId, seedKey]);
}
