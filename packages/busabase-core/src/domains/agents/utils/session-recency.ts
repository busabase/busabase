/**
 * Newest-first order for agent sessions.
 *
 * `lastActivityAt` alone is not a total order. Disconnecting an agent ends all
 * of its sessions in one statement, which stamps every one with the same
 * instant (it is also their retention clock, so it has to move). With all of
 * them tied, "latest" was whichever row the database returned first, and the
 * disconnected card took that session's name — so it flipped between runs.
 * Ties fall back to the newest conversation, then to the id.
 */
export interface SessionRecencyKey {
  id: string;
  createdAt: string;
  lastActivityAt: string;
}

export const compareSessionsByRecency = (a: SessionRecencyKey, b: SessionRecencyKey): number =>
  b.lastActivityAt.localeCompare(a.lastActivityAt) ||
  b.createdAt.localeCompare(a.createdAt) ||
  b.id.localeCompare(a.id);
