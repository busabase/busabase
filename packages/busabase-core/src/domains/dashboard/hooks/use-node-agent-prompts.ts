"use client";

/**
 * One node's Agent prompts, ready to render: the node type's curated scenarios
 * and derived capabilities, with this node's CUSTOM scenarios fetched and
 * appended after the built-in set.
 *
 * Extracted from `node-agent-prompts-dialog` when the Skill node grew a prompts
 * TAB: the dialog and the tab differ in what frames them and in nothing else, so
 * the fetch, the loading rule and the context assembly live here once. Feed the
 * result straight into `AgentPromptsView`.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { CustomAgentPrompts } from "busabase-contract/contract/node-agent-prompt-schemas";
import { useCallback, useMemo } from "react";
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
  customPrompts: CustomAgentPrompts;
  canSaveCustomPrompts: boolean;
  saving: boolean;
  saveCustomPrompts: (prompts: CustomAgentPrompts) => Promise<void>;
  /** True only while a FIRST read of the custom prompts is in flight. */
  loading: boolean;
}

/** The API uses `null`, not an empty array, to clear the node's custom tier. */
export const agentPromptsUpdateValue = (prompts: CustomAgentPrompts): CustomAgentPrompts | null =>
  prompts.length > 0 ? prompts : null;

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
   * scope, where custom prompts never apply (they extend the whole-node
   * scenario tier only, see `buildNodeAgentPrompts`).
   */
  enabled?: boolean;
}): NodeAgentPrompts => {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const queryClient = useQueryClient();

  const promptsOptions = orpc?.nodes.getAgentPrompts.queryOptions({ input: { nodeId } });
  const promptsQuery = useQuery({
    queryKey: promptsOptions?.queryKey ?? ["node-agent-prompts", "not-fetched", nodeId],
    // Never runs — `enabled` is false whenever there are no real options — but it
    // has to satisfy the same result type so the query stays typed.
    queryFn: promptsOptions?.queryFn ?? (async () => ({ nodeId, agentPrompts: null })),
    enabled: enabled && promptsOptions !== undefined,
  });
  const updateOptions = orpc?.nodes.updateAgentPrompts.mutationOptions();
  const updateMutation = useMutation({
    ...(updateOptions ?? {
      mutationFn: async () => {
        throw new Error("Agent prompt editing is unavailable in this host.");
      },
    }),
    onSuccess: (result) => {
      if (!promptsOptions) return;
      queryClient.setQueryData(promptsOptions.queryKey, result);
      void queryClient.invalidateQueries({ queryKey: promptsOptions.queryKey });
    },
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

  const customPrompts = promptsQuery.data?.agentPrompts ?? [];
  const canSaveCustomPrompts = Boolean(
    orpc && enabled && (scope === undefined || scope.kind === "node"),
  );
  const saveCustomPrompts = useCallback(
    async (prompts: CustomAgentPrompts) => {
      await updateMutation.mutateAsync({
        nodeId,
        agentPrompts: agentPromptsUpdateValue(prompts),
      });
    },
    [nodeId, updateMutation],
  );
  return {
    scenarios,
    capabilities,
    customPrompts,
    canSaveCustomPrompts,
    saving: updateMutation.isPending,
    saveCustomPrompts,
    loading,
  };
};
