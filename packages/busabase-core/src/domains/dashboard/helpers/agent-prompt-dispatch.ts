/**
 * The last thing that happens to a prompt before it leaves Busabase.
 *
 * A node prompt has three parts the user can read in the preview — the target
 * line, the body, the merge/reply footer — and a FOURTH that only exists on the
 * way out: a paragraph telling the agent to check it is actually connected to
 * this space, with a link to the credential-free setup guide.
 *
 * Why it is not in the preview: the target line is the one part people copy on
 * its own ("just tell my agent which node"), so it has to stay visible and
 * selectable — and the connection check is machine-facing boilerplate that is
 * identical on every one of the ~10 prompts in the list. Showing it would push
 * the part a human actually reads off the top of the box, to say something no
 * human needs to read.
 *
 * Why it is needed at all: Busabase's agents (Claude Code, Codex CLI, the Buda
 * AI Agent) are external ACP agents running on the user's own machine. Unlike
 * the MCP surface, nothing guarantees they have the busabase skill installed or
 * pointed at this space, so a prompt that just says "edit nodeId nod_x" can land
 * on an agent with no way to reach it.
 *
 * Both exits render through here — the Copy button and Ask Agent — precisely so
 * there is no second copy of this assembly to drift out of sync.
 *
 * Pure: takes a resolved setup URL and the localized strings, returns text. No
 * react, no `window`, no transport, so the exact bytes an agent receives can be
 * asserted in a unit test instead of read off a screenshot. Resolving the URL
 * (which needs the live browser origin) stays with the caller.
 */

export interface AgentConnectionCheckOptions {
  /** Credential-free onboarding guide for this host and target space. */
  setupUrl: string;
  /** Cloud only: the exact space the agent must be pointed at. */
  targetSpaceId?: string;
  /** `messages.agentPrompts.connectionCheck` — `{targetSpace}` + `{setupUrl}`. */
  connectionCheck: string;
  fmt: (template: string, values: Record<string, string>) => string;
}

/**
 * The shared paragraph, interpolated — no lead-in.
 *
 * Each caller owns its own lead-in ("Before installing, " for the install tab,
 * `connectionCheckLeadIn` for a node prompt) because the two read differently
 * at that one seam and identically everywhere after it. Keeping the lead-in out
 * of this key is what lets the install prompt's rendered output stay unchanged
 * while the paragraph itself becomes shared.
 */
export const renderAgentConnectionCheck = ({
  setupUrl,
  targetSpaceId,
  connectionCheck,
  fmt,
}: AgentConnectionCheckOptions): string =>
  fmt(connectionCheck, {
    setupUrl,
    // Rendered as a parenthetical so the sentence still reads when Desktop has
    // no space to name — same shape `buildAgentInstallPrompt` has always used.
    targetSpace: targetSpaceId ? ` (${targetSpaceId})` : "",
  });

export interface AgentPromptDispatchOptions {
  /** The prompt exactly as the preview shows it. */
  body: string;
  /**
   * Credential-free onboarding guide for this host and target space, or
   * `undefined` when the host could not resolve one — no edition, or no browser
   * origin to build it from (SSR, the chromeless mobile WebView).
   */
  setupUrl?: string;
  targetSpaceId?: string;
  /** `messages.agentPrompts.connectionCheckLeadIn`. */
  leadIn: string;
  /** `messages.agentPrompts.connectionCheck`. */
  connectionCheck: string;
  fmt: (template: string, values: Record<string, string>) => string;
}

/**
 * The exact text that goes to the clipboard, or to an agent over Ask Agent.
 *
 * With no setup URL this returns the body untouched, on purpose. The tempting
 * alternative — fall back to a default origin — is actively harmful here: a
 * guide pointing at `localhost:15419` handed to a Cloud user's agent sends it
 * to a machine that is not theirs, which is worse than saying nothing and
 * letting the agent use whatever connection it already has. Silence is the
 * safe degradation; a wrong URL is not.
 */
export const renderPromptForDispatch = ({
  body,
  setupUrl,
  targetSpaceId,
  leadIn,
  connectionCheck,
  fmt,
}: AgentPromptDispatchOptions): string => {
  if (!setupUrl) return body;
  const paragraph = renderAgentConnectionCheck({ connectionCheck, fmt, setupUrl, targetSpaceId });
  return `${body}\n\n${leadIn}${paragraph}`;
};
