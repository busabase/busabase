"use client";

/**
 * The Ask Agent flow, from "a prompt is selected" to "the panel is open with it
 * in the composer".
 *
 * Lives in the agents domain rather than in the prompts dialog because none of
 * it is about prompts: it is catalog → target → session → side panel, and the
 * `@`-mention feature performs the same sequence from a different trigger.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentSessionVO } from "busabase-contract/domains/agents/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { openAgentChatTab } from "../../dashboard/components/side-panel-sources";
import { type AgentTarget, chooseAgentTarget, normalizeAgentTargets } from "../utils/agent-targets";
import { lookupNodeAgentSession, rememberNodeAgentSession } from "../utils/node-agent-sessions";

/** Monotonic enough for a one-shot handoff id; never persisted or compared across tabs. */
let draftCounter = 0;
const nextDraftId = (): string => {
  draftCounter += 1;
  return `ask-agent-${Date.now()}-${draftCounter}`;
};

export interface UseAskAgentOptions {
  orpc: BusabaseQueryUtils;
  /** Which node the question is about — the other half of the session key. */
  nodeId: string;
  /** Called once the panel has the prompt, so the trigger can close itself. */
  onHandedOff: () => void;
  /** Called when nothing is connected yet, to route to the add-agent flow. */
  onNoAgents: () => void;
}

export function useAskAgent({ orpc, nodeId, onHandedOff, onNoAgents }: UseAskAgentOptions) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const queryClient = useQueryClient();
  // The prompt body the user asked about, held from the click until a target is
  // resolved. Non-null is also what "the flow is running" means — the catalog
  // is only fetched from here, so merely opening the prompts dialog to copy
  // some text never probes the machine for agent binaries.
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<AgentTarget | null>(null);
  const [targets, setTargets] = useState<AgentTarget[] | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const started = useRef(false);

  const enabled = pendingPrompt !== null;
  const needsCatalog = enabled && pendingTarget === null;
  const catalog = useQuery({ ...orpc.agents.catalog.queryOptions(), enabled: needsCatalog });
  const sessions = useQuery({ ...orpc.agents.sessions.list.queryOptions(), enabled });
  const createSession = useMutation(orpc.agents.sessions.create.mutationOptions());

  const launchable = useMemo(
    () => (catalog.data ? normalizeAgentTargets(catalog.data) : []),
    [catalog.data],
  );

  const reset = useCallback(() => {
    started.current = false;
    setPendingPrompt(null);
    setPendingTarget(null);
    setTargets(null);
    setStartError(null);
  }, []);

  /**
   * Open the conversation and hand the prompt over.
   *
   * `createAgentSession` is awaited — it returns as soon as the session exists.
   * `promptAgentSession` is deliberately NOT called: it does not resolve until
   * the agent's whole turn is done, and parks indefinitely on a permission
   * card, so awaiting it in a click handler would hang the UI for minutes. The
   * user's Enter is what sends.
   */
  const handOff = useCallback(
    async (target: AgentTarget, promptBody: string) => {
      setStartError(null);
      const known = (sessions.data ?? []) as AgentSessionVO[];
      let sessionId = lookupNodeAgentSession(known, nodeId, target.slug);

      if (!sessionId) {
        try {
          const created = await createSession.mutateAsync({ slug: target.slug });
          sessionId = created.id;
        } catch (error) {
          // Stays in the dialog with the prompt still selected: the cause is
          // usually fixable (agent not installed, Buda signed out) and the
          // retry should not cost the user their place.
          setStartError(
            presentCoreError(messages, locale, error, messages.agentPrompts.askAgentLoadFailed),
          );
          started.current = false;
          return;
        }
        // Without this the panel sits on "No sessions yet" until the 4s poll in
        // AgentDetailView catches up — the composer only mounts once the
        // session list contains the session, so the prefill would land seconds
        // after the click that asked for it.
        await queryClient.invalidateQueries({ queryKey: orpc.agents.sessions.list.queryKey() });
      }

      rememberNodeAgentSession(nodeId, target.slug, sessionId);
      openAgentChatTab(target.slug, target.name, {
        sessionId,
        draft: { id: nextDraftId(), text: promptBody },
      });
      reset();
      onHandedOff();
    },
    [createSession, locale, messages, nodeId, onHandedOff, orpc, queryClient, reset, sessions.data],
  );

  /**
   * Continue once the catalog and session list have both landed.
   *
   * Loading, failed and genuinely-empty are three different answers and are
   * kept apart here on purpose: routing to the add-agent flow happens ONLY on a
   * successful, actually-empty catalog. Treating a failed request as "no
   * agents" would bounce someone with a working setup into a setup wizard
   * because their network blinked.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `handOff` is stable per render inputs; adding it re-runs the effect mid-flight.
  useEffect(() => {
    if (pendingPrompt === null || started.current) return;
    if (sessions.isPending || sessions.isError) return;
    if (pendingTarget) {
      started.current = true;
      void handOff(pendingTarget, pendingPrompt);
      return;
    }
    if (catalog.isPending || catalog.isError) return;

    started.current = true;
    const choice = chooseAgentTarget(launchable);
    if (choice.kind === "none") {
      reset();
      onNoAgents();
      return;
    }
    if (choice.kind === "single") {
      void handOff(choice.target, pendingPrompt);
      return;
    }
    setTargets(choice.targets);
  }, [
    catalog.isError,
    catalog.isPending,
    launchable,
    onNoAgents,
    pendingPrompt,
    pendingTarget,
    reset,
    retryVersion,
    sessions.isError,
    sessions.isPending,
  ]);

  /** The Ask Agent click. `promptBody` is the fully-interpolated prompt text. */
  const ask = useCallback((promptBody: string) => {
    started.current = false;
    setStartError(null);
    setTargets(null);
    setPendingTarget(null);
    setPendingPrompt(promptBody);
  }, []);

  /** Hand the prompt to a target already chosen by a caller-owned connection list. */
  const askTarget = useCallback((promptBody: string, target: AgentTarget) => {
    started.current = false;
    setStartError(null);
    setTargets(null);
    setPendingTarget(target);
    setPendingPrompt(promptBody);
  }, []);

  const retry = useCallback(() => {
    started.current = false;
    setStartError(null);
    setRetryVersion((version) => version + 1);
    if (pendingTarget === null) void catalog.refetch();
    void sessions.refetch();
  }, [catalog, pendingTarget, sessions]);

  const pickTarget = useCallback(
    (target: AgentTarget) => {
      if (pendingPrompt === null) return;
      void handOff(target, pendingPrompt);
    },
    [handOff, pendingPrompt],
  );

  return {
    ask,
    askTarget,
    /** Non-null while the user has more than one launchable target to pick from. */
    targets,
    pickTarget,
    retry,
    reset,
    isActive: enabled,
    isLoading: enabled && (sessions.isPending || (pendingTarget === null && catalog.isPending)),
    /** Catalog/session lookup failed. Distinct from "no agents" — never routes away. */
    loadError: enabled && (sessions.isError || (pendingTarget === null && catalog.isError)),
    /** The session could not be created. Keeps the dialog and the selection alive. */
    startError,
    isStarting: createSession.isPending,
  };
}
