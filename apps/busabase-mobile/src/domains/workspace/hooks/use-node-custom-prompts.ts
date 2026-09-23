import { useQuery } from "@tanstack/react-query";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import type { NodePromptContext } from "../utils/node-agent-prompts";

type CustomPrompts = NodePromptContext["customPrompts"];

/**
 * A node's custom agent prompts, so the phone shows what was configured for it
 * rather than only the built-in defaults for its type.
 *
 * The sheet used to build its context without this field at all, so a node with
 * custom prompts saved against it rendered its type's five stock scenarios and
 * nothing else — the configured ones were invisible on mobile, with no hint
 * that anything was missing.
 *
 * Returns `undefined` — the same thing the caller passes while the request is
 * in flight — whenever they cannot be read. The sheet then shows the built-in
 * scenarios, exactly as it did before custom prompts existed, which is also
 * what the web dashboard does when its own fetch fails. Custom prompts are an
 * addition to that list; failing to load them is not worth replacing a working
 * panel with an error.
 */
export function useNodeCustomPrompts({
  nodeId,
  enabled,
}: {
  nodeId: string;
  enabled: boolean;
}): CustomPrompts {
  const buda = useBusabaseOrpc();

  const query = useQuery({
    queryKey: ["node-agent-prompts", buda?.spaceScope ?? "no-connection", nodeId],
    enabled: enabled && !!buda,
    // One attempt: this is a best-effort enrichment behind an already-open
    // sheet, and a retry storm would delay the built-in prompts that are
    // already on screen.
    retry: false,
    queryFn: async (): Promise<CustomPrompts> => {
      if (!buda) return undefined;
      const detail = await buda.client.nodes.getAgentPrompts({ nodeId });
      return detail.agentPrompts ?? undefined;
    },
  });

  // Deliberately NOT branching on `isMissingRouteError` here, unlike the
  // Inbox and install fallbacks. `getAgentPrompts` takes a nodeId, so its
  // NOT_FOUND is ambiguous: verified against a running server, a missing node
  // and a missing route both reach the client as
  // `ORPCError { code: "NOT_FOUND", status: 404 }`, differing only in a message
  // this app deliberately does not read. They need the same handling anyway —
  // show the built-in prompts — so there is nothing to gain by guessing which
  // one it was, and a wrong guess would only add a false claim to a log.
  return query.data;
}
