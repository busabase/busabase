import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { PromptResourceContextInput } from "busabase-contract/domains/agents/prompt-context";
import { agentPromptResourceUri } from "busabase-contract/domains/agents/prompt-context";
import type { AgentContextResourceVO } from "busabase-contract/domains/agents/types";

/** Immutable prompt snapshots are embedded data; these URIs are never fetched. */
export function promptResourceContextToContentBlock(
  snapshot: PromptResourceContextInput,
): Extract<ContentBlock, { type: "resource" }> {
  return {
    type: "resource",
    resource: {
      uri: agentPromptResourceUri(snapshot.id),
      mimeType: "text/plain",
      text: snapshot.text,
    },
    _meta: {
      "acp-ui.resourceContext": { id: snapshot.id, name: snapshot.name },
    },
  };
}

/** One representation for both transcript replay and the negotiated ACP send. */
export function contextResourceToContentBlock(
  snapshot: AgentContextResourceVO,
): Extract<ContentBlock, { type: "resource" }> {
  return {
    type: "resource",
    resource: { uri: snapshot.uri, mimeType: snapshot.mimeType, text: snapshot.text },
    annotations: snapshot.annotations,
    _meta: {
      "busabase.node": {
        id: snapshot.nodeId,
        type: snapshot.nodeType,
        name: snapshot.name,
        slug: snapshot.slug,
        ...(snapshot.icon !== undefined ? { icon: snapshot.icon } : {}),
        truncated: snapshot.truncated,
      },
    },
  };
}
