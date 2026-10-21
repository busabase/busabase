/**
 * The last thing that happens to a prompt before it leaves Busabase.
 *
 * A node prompt has four parts: the target line, the task, the merge/reply
 * footer, and — only when the host knows which Busabase this is — a paragraph
 * telling the agent to reach this space through the busabase skill, MCP or CLI,
 * with a link to the credential-free setup guide.
 *
 * All four are in the preview. The connection check used to be appended only on
 * the way out, which meant the text people saw was not the text their agent got,
 * and a hand-selected copy silently lost it. Instead the preview now renders the
 * same segments this module returns and turns the framing down (target, footer,
 * connection check) so the task still reads first.
 *
 * Why the check is needed at all: Busabase's agents (Claude Code, Codex CLI, the
 * Buda AI Agent) are external ACP agents running on the user's own machine.
 * Unlike the MCP surface, nothing guarantees they have the busabase skill
 * installed or pointed at this space, so a prompt that just says "edit nodeId
 * nod_x" can land on an agent with no way to reach it — and one that then opens
 * Busabase in a browser instead.
 *
 * Every exit renders through here — the preview, the Copy button and Ask Agent —
 * precisely so there is no second copy of this assembly to drift out of sync.
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
  /** The prompt body — `NodePrompt.body`. */
  body: string;
  /** `NodePrompt.target`: split off the top when the body opens with it. */
  target?: string;
  /** `NodePrompt.footer`: split off the end when the body closes on it. */
  footer?: string;
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

/** Framing the preview turns down (`target`, `footer`, `connection`) vs. the `task` it leads with. */
export type PromptSegmentKind = "target" | "task" | "footer" | "connection";

export interface PromptSegment {
  kind: PromptSegmentKind;
  text: string;
}

const PARAGRAPH_BREAK = "\n\n";

export const joinPromptSegments = (segments: PromptSegment[]): string =>
  segments.map((segment) => segment.text).join(PARAGRAPH_BREAK);

/**
 * Split a body back into target / task / footer using the exact strings it was
 * assembled from. Every node prompt, built-in or custom, opens with its target
 * line; a body that does not (or does not close on the footer) simply keeps that
 * part in the task. Anything that would not join back to the identical body is
 * left whole.
 */
const splitBody = (body: string, target?: string, footer?: string): PromptSegment[] => {
  let task = body;
  const head: PromptSegment[] = [];
  const tail: PromptSegment[] = [];
  if (target && task.startsWith(`${target}${PARAGRAPH_BREAK}`)) {
    head.push({ kind: "target", text: target });
    task = task.slice(target.length + PARAGRAPH_BREAK.length);
  }
  if (footer && task === footer) {
    tail.push({ kind: "footer", text: footer });
    task = "";
  } else if (footer && task.endsWith(`${PARAGRAPH_BREAK}${footer}`)) {
    tail.push({ kind: "footer", text: footer });
    task = task.slice(0, -(PARAGRAPH_BREAK.length + footer.length));
  }
  const segments = [...head, ...(task ? [{ kind: "task" as const, text: task }] : []), ...tail];
  return joinPromptSegments(segments) === body ? segments : [{ kind: "task", text: body }];
};

/**
 * The prompt as the preview shows it — and, joined, exactly what goes to the
 * clipboard or to an agent over Ask Agent.
 *
 * With no setup URL there is no connection segment, on purpose. The tempting
 * alternative — fall back to a default origin — is actively harmful here: a
 * guide pointing at `localhost:15419` handed to a Cloud user's agent sends it
 * to a machine that is not theirs, which is worse than saying nothing and
 * letting the agent use whatever connection it already has. Silence is the
 * safe degradation; a wrong URL is not.
 */
export const renderPromptSegments = ({
  body,
  target,
  footer,
  setupUrl,
  targetSpaceId,
  leadIn,
  connectionCheck,
  fmt,
}: AgentPromptDispatchOptions): PromptSegment[] => {
  const segments = splitBody(body, target, footer);
  if (!setupUrl) return segments;
  const paragraph = renderAgentConnectionCheck({ connectionCheck, fmt, setupUrl, targetSpaceId });
  return [...segments, { kind: "connection", text: `${leadIn}${paragraph}` }];
};

/** The exact text that goes to the clipboard, or to an agent over Ask Agent. */
export const renderPromptForDispatch = (options: AgentPromptDispatchOptions): string =>
  joinPromptSegments(renderPromptSegments(options));
