import "server-only";

import { cache } from "openlib/cache";
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
 * The module-level `Map` is only a hot cache. The authoritative target is also
 * written to the configured cache because Next.js can evaluate the RPC stream
 * and Preview route in separate module contexts even in a single replica.
 * Production Sandock requires Redis; run sessions remain process-owned and
 * therefore still require the explicit single-instance topology.
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
const PREVIEW_TARGET_TTL_SECONDS = 4 * 60 * 60;

const previewTargetKey = (nodeId: string, owner: string): string =>
  `busabase:airapp-preview:${Buffer.from(JSON.stringify([owner, nodeId])).toString("base64url")}`;

/**
 * The owner key for the current server-side context — used by the runtime when
 * it registers a preview. `getContextActorId()` is `undefined` on the
 * open-source host, which is a positive fact ("nobody is authenticated here"),
 * not a missing value.
 */
export const currentPreviewOwner = (): string => getContextActorId() ?? LOCAL_PREVIEW_OWNER;

export async function registerLocalPreview(
  nodeId: string,
  owner: string,
  targetBaseUrl: string,
): Promise<void> {
  const target = targetBaseUrl.replace(/\/+$/, "");
  const forOwner = localPreviewPorts.get(owner) ?? new Map<string, string>();
  forOwner.set(nodeId, target);
  localPreviewPorts.set(owner, forOwner);
  try {
    const provider = await cache;
    await provider?.set(previewTargetKey(nodeId, owner), target, PREVIEW_TARGET_TTL_SECONDS);
  } catch (error) {
    console.warn("[AirApp Preview] Failed to persist preview target:", error);
  }
}

export async function getLocalPreviewTarget(
  nodeId: string,
  owner: string,
): Promise<string | undefined> {
  try {
    const provider = await cache;
    if (!provider) return localPreviewPorts.get(owner)?.get(nodeId);
    const shared = await provider.get(previewTargetKey(nodeId, owner));
    if (!shared) {
      const forOwner = localPreviewPorts.get(owner);
      if (forOwner) {
        forOwner.delete(nodeId);
        if (forOwner.size === 0) localPreviewPorts.delete(owner);
      }
      return undefined;
    }
    const forOwner = localPreviewPorts.get(owner) ?? new Map<string, string>();
    forOwner.set(nodeId, shared);
    localPreviewPorts.set(owner, forOwner);
    return shared;
  } catch (error) {
    console.warn("[AirApp Preview] Failed to read shared preview target:", error);
    return undefined;
  }
}

export async function unregisterLocalPreview(
  nodeId: string,
  owner: string,
  expectedTarget?: string,
): Promise<void> {
  const forOwner = localPreviewPorts.get(owner);
  if (forOwner) {
    const current = forOwner.get(nodeId);
    if (!expectedTarget || current === expectedTarget.replace(/\/+$/, "")) {
      forOwner.delete(nodeId);
      if (forOwner.size === 0) localPreviewPorts.delete(owner);
    }
  }
  try {
    const provider = await cache;
    if (!provider) return;
    const key = previewTargetKey(nodeId, owner);
    if (expectedTarget) {
      await provider.deleteIfValue(key, expectedTarget.replace(/\/+$/, ""));
    } else {
      await provider.del(key);
    }
  } catch (error) {
    console.warn("[AirApp Preview] Failed to remove shared preview target:", error);
  }
}
