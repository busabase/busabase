/**
 * Space storage change notifications.
 *
 * Shared asset code adds and removes billable bytes: adopting an existing
 * attachment into a space, dropping an Asset row, or purging a subtree. The
 * bytes are counted from `attachments` / `busabase_assets`, so the shared layer
 * does not need to know how a host meters storage — but a host that keeps a
 * *counter* (rather than recounting on every read) does need to hear about it.
 *
 * Hosts subscribe with `setSpaceStorageChangeHook`. Self-hosted builds leave it
 * unset and pay nothing. Notifications fire only after the change has committed,
 * so a subscriber may re-read the database without seeing half a purge.
 */
import type { getDb } from "../../../db";

export type SpaceStorageChangeHook = (
  db: Awaited<ReturnType<typeof getDb>>,
  spaceIds: string[],
) => Promise<void>;

let hook: SpaceStorageChangeHook | null = null;

/** Register the host's meter. Passing null detaches it (tests, shutdown). */
export function setSpaceStorageChangeHook(next: SpaceStorageChangeHook | null) {
  hook = next;
}

/**
 * Tell the host that these spaces' stored bytes changed.
 *
 * Best effort on purpose: a metering problem must never undo or fail a delete
 * the user already asked for. Hosts that keep a counter also reconcile on a
 * schedule, so a missed notification costs accuracy for one sweep, not forever.
 */
export async function notifySpaceStorageChanged(
  db: Awaited<ReturnType<typeof getDb>>,
  spaceIds: string | string[],
): Promise<void> {
  if (!hook) return;
  const unique = [...new Set(Array.isArray(spaceIds) ? spaceIds : [spaceIds])].filter(Boolean);
  if (!unique.length) return;
  try {
    await hook(db, unique);
  } catch (error) {
    console.error("[busabase] Space storage change notification failed", error);
  }
}
