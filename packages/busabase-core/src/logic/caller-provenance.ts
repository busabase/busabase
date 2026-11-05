import "server-only";

import { getContextActorId, getContextSourceProvenance, getContextSpaceId } from "../context";

/**
 * Who is behind the request currently in flight, in one log-friendly string:
 * actor, space, and whichever of channel / API key / key owner / agent /
 * playbook the request carries.
 *
 * Written because a production bug ("an integration asks for the whole Drive
 * every 11 s") could only be named from a log line, and a bare "anonymous"
 * told nobody anything. Every field here already exists on the request — this
 * only formats it.
 */
export const describeCaller = (): string => {
  const provenance = getContextSourceProvenance();
  const parts = [`actor=${getContextActorId() ?? "anonymous"}`, `space=${getContextSpaceId()}`];
  if (provenance?.channel) parts.push(`channel=${provenance.channel}`);
  if (provenance?.apiKey?.id) {
    parts.push(`apiKey=${provenance.apiKey.id}(${provenance.apiKey.name ?? ""})`);
  }
  if (provenance?.owner?.email) parts.push(`owner=${provenance.owner.email}`);
  if (provenance?.agent) parts.push(`agent=${provenance.agent.id}(${provenance.agent.name})`);
  if (provenance?.playbook) {
    parts.push(`playbook=${provenance.playbook.nodeSlug || provenance.playbook.nodeId}`);
  }
  return parts.join(" ");
};
