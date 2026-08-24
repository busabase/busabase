import "server-only";

import { getContextActorId } from "../../../context";

/**
 * In-process registry mapping a running AirApp preview to the origin the proxy
 * should forward to. Populated by `local-runtime.ts` when a run
 * reaches its `ready` state and cleared when the run ends; read by the
 * `/api/airapp-preview/{nodeId}/…` reverse-proxy route to know where to
 * forward requests.
 *
 * **Keyed by `(nodeId, owner)`, not by `nodeId` alone.** Two things depend on
 * that, and both used to be broken:
 *
 * 1. *Correctness.* Two concurrent runs of one node each bind their own port,
 *    but under a nodeId-only key the second registration overwrote the first,
 *    and whichever run finished first unregistered the entry — 404ing the
 *    other run's preview while it was still serving.
 * 2. *Authorization.* Starting a run requires `write` on the node. Viewing one
 *    required nothing at all: the proxy route performed no permission check, so
 *    anyone who knew a nodeId could watch somebody else's running app. Scoping
 *    the lookup to the requester's own owner key means a request that isn't
 *    from the person who started the run simply finds nothing.
 *
 * The owner key is the host-authenticated actor where there is one, and a
 * single shared constant on the open-source single-user host, where "another
 * user" does not exist.
 *
 * IMPORTANT — this is a module-level `Map`, so it is single-server /
 * single-process only, the same limitation class as the `SandboxManager`
 * process-wide singleton the local runtime already relies on: a run and the
 * proxy request for its preview must be handled by the same Next.js server
 * process. That is already true for a host-spawned process (it is reachable
 * only from the host that spawned it), so no external store is needed here.
 */

/** Owner key on a host with no authenticated actor (open-source, single user). */
export const LOCAL_PREVIEW_OWNER = "local";

/**
 * Nested (owner -> nodeId -> port) rather than a single map under a composite
 * string key. A concatenated key is forgeable whenever the separator can appear
 * in either part: with `"${owner} ${nodeId}"`, owner `"a c"` + node `"b"` and
 * owner `"a"` + node `"c b"` produce the same string, so one owner could reach
 * another's entry by being named appropriately. Real ids are generated and
 * contain no spaces, but "the inputs happen to be well-behaved" is the wrong
 * thing to rest an authorization boundary on. Nesting removes the question.
 */
/**
 * A base URL, not a port. The local engine registers `http://127.0.0.1:{port}`;
 * a remote engine registers whatever origin its sandbox is reachable at. The
 * proxy therefore never learns which engine produced the preview it is
 * forwarding — which is the property that lets a cross-origin engine reuse the
 * same-origin preview path instead of needing its own.
 */
const localPreviewPorts = new Map<string, Map<string, string>>();

/**
 * The owner key for the current server-side context — used by the runtime when
 * it registers a preview. `getContextActorId()` is `undefined` on the
 * open-source host, which is a positive fact ("nobody is authenticated here"),
 * not a missing value.
 */
export const currentPreviewOwner = (): string => getContextActorId() ?? LOCAL_PREVIEW_OWNER;

export function registerLocalPreview(nodeId: string, owner: string, targetBaseUrl: string): void {
  const forOwner = localPreviewPorts.get(owner) ?? new Map<string, string>();
  forOwner.set(nodeId, targetBaseUrl.replace(/\/+$/, ""));
  localPreviewPorts.set(owner, forOwner);
}

export function getLocalPreviewTarget(nodeId: string, owner: string): string | undefined {
  return localPreviewPorts.get(owner)?.get(nodeId);
}

export function unregisterLocalPreview(nodeId: string, owner: string): void {
  const forOwner = localPreviewPorts.get(owner);
  if (!forOwner) return;
  forOwner.delete(nodeId);
  // Drop the owner bucket once empty so a long-lived server doesn't accumulate
  // one entry per user who has ever run an AirApp.
  if (forOwner.size === 0) localPreviewPorts.delete(owner);
}
