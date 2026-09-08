"use client";

/**
 * One node's Agent prompts, ready to render: the node type's curated scenarios
 * and derived capabilities, with this node's CUSTOM scenarios already fetched
 * and substituted in.
 *
 * Extracted from `node-agent-prompts-dialog` when the Skill node grew a prompts
 * TAB: the dialog and the tab differ in what frames them and in nothing else, so
 * the fetch, the loading rule and the context assembly live here once. Feed the
 * result straight into `AgentPromptsView`.
 */

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { useMemo } from "react";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import {
  buildNodeAgentPrompts,
  type NodePrompt,
  type NodePromptContext,
  type NodePromptScope,
} from "../helpers/node-agent-prompts";

export interface NodeAgentPrompts {
  scenarios: NodePrompt[];
  capabilities: NodePrompt[];
  /** True only while a FIRST read of the custom prompts is in flight. */
  loading: boolean;
}

export const useNodeAgentPrompts = ({
  nodeId,
  nodeName,
  nodeType,
  spaceId,
  spaceName,
  scope,
  orpc,
  enabled = true,
}: {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  spaceId?: string;
  spaceName?: string;
  scope?: NodePromptScope;
  /**
   * `null`/`undefined` for a host that never wired oRPC (the chromeless mobile
   * WebView, SSR): the node then shows its type's defaults, which is what it did
   * before custom prompts existed.
   */
  orpc: BusabaseQueryUtils | null | undefined;
  /**
   * `false` to skip the fetch entirely — a closed dialog, or a field/record/cell
   * scope, where custom prompts never apply (they replace the whole-node
   * scenario tier only, see `buildNodeAgentPrompts`).
   */
  enabled?: boolean;
}): NodeAgentPrompts => {
  const messages = useCoreI18n();
  const locale = useCoreLocale();

  const promptsOptions = orpc?.nodes.getAgentPrompts.queryOptions({ input: { nodeId } });
  const promptsQuery = useQuery({
    queryKey: promptsOptions?.queryKey ?? ["node-agent-prompts", "not-fetched", nodeId],
    // Never runs — `enabled` is false whenever there are no real options — but it
    // has to satisfy the same result type so the query stays typed.
    queryFn: promptsOptions?.queryFn ?? (async () => ({ nodeId, agentPrompts: null })),
    enabled: enabled && promptsOptions !== undefined,
  });
  // A disabled query stays `pending` forever, so the spinner has to be gated on
  // there being a fetch at all — otherwise a caller that deliberately never
  // fetches would show a spinner that never resolves.
  const loading = promptsOptions !== undefined && enabled && promptsQuery.isPending;

  const context: NodePromptContext = useMemo(
    () => ({
      nodeType,
      nodeName,
      nodeId,
      spaceId,
      spaceName,
      scope,
      customPrompts: promptsQuery.data?.agentPrompts ?? undefined,
    }),
    [nodeType, nodeName, nodeId, spaceId, spaceName, scope, promptsQuery.data],
  );

  const { scenarios, capabilities } = useMemo(
    () => buildNodeAgentPrompts(context, locale, messages),
    [context, locale, messages],
  );

  return { scenarios, capabilities, loading };
};
