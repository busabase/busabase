import "server-only";

import { decodeEmbedCapability, EMBED_RUNTIME_CAPABILITY_HEADER } from "./capability";
import { type EmbedRequestContext, resolveEmbedRequestContext } from "./logic";

export type EmbedCapabilityRequest =
  /** No capability header — the host serves the request its usual way. */
  | { kind: "absent" }
  /** A capability header that is malformed, expired, revoked, or unknown. */
  | { kind: "rejected" }
  /** A live capability; run the request inside `runWithEmbedContext(context)`. */
  | { kind: "embed"; context: EmbedRequestContext };

/**
 * Read an Embed Link capability off an RPC request, shared by both hosts.
 *
 * An embedded Dashboard runs cross-site inside an iframe, where third-party
 * cookie policy cannot be relied on — so the capability travels as an explicit
 * header rather than the `/embed/:id`-scoped cookie the top-level page uses.
 *
 * "Header present but unusable" is deliberately its own outcome. Falling
 * through to the host's default would mean a revoked link silently downgrading
 * to whatever an un-credentialed request gets — on the open-source single-user
 * host that is FULL local access, which is the opposite of failing closed.
 */
export const readEmbedCapabilityRequest = async (
  request: Request,
  withHostContext: <T>(fn: () => Promise<T>) => Promise<T> = (fn) => fn(),
): Promise<EmbedCapabilityRequest> => {
  const header = request.headers.get(EMBED_RUNTIME_CAPABILITY_HEADER);
  if (header === null) return { kind: "absent" };

  const capability = decodeEmbedCapability(header);
  if (!capability) return { kind: "rejected" };

  const context = await withHostContext(() =>
    resolveEmbedRequestContext(capability.id, capability.secret),
  );
  return context ? { kind: "embed", context } : { kind: "rejected" };
};
