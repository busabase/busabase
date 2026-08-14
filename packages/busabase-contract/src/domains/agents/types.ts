/**
 * Agents domain — DTO (inputs) and VO (outputs) for driving EXTERNAL ACP agents.
 *
 * Standalone zod only: no drizzle, no `~/db`, no server imports. These types are
 * pulled into the browser bundle and the mobile client is generated from them.
 *
 * Vocabulary note: an "agent" here is a *backend we connect out to* (Claude Code,
 * Codex, a remote Buda agent), NOT one of Busabase's own nodes. See
 * `apps/busabase-cloud/content/spec/agent-integrations.md`.
 */
import { z } from "zod";

/**
 * How a backend is reached. This is the axis that decides everything else:
 * `local-subprocess` runs on whichever machine serves the request (the user's
 * own laptop on the tunnel path), `remote-websocket` needs no local process at
 * all and is therefore the only kind mobile can use.
 */
export const AgentTransportSchema = z.enum(["local-subprocess", "remote-websocket"]);
export type AgentTransport = z.infer<typeof AgentTransportSchema>;

/** A connectable backend offered to the user. */
export const AgentCatalogEntryVOSchema = z.object({
  /** Stable slug. For registry agents this is the official ACP registry id. */
  slug: z.string(),
  name: z.string(),
  description: z.string().default(""),
  transport: AgentTransportSchema,
  /** Present for registry-sourced entries; absent for built-ins like Buda. */
  version: z.string().nullable().default(null),
  /** Whether this entry can be launched right now (binary present / URL configured). */
  available: z.boolean().default(false),
  /** Human-readable reason when `available` is false — never a bare "failed". */
  unavailableReason: z.string().nullable().default(null),
});
export type AgentCatalogEntryVO = z.infer<typeof AgentCatalogEntryVOSchema>;

/**
 * `waiting_permission` is deliberately its own status, not folded into `busy`:
 * the UI needs to tell "the agent is thinking" apart from "the agent is
 * blocked on a human decision it cannot proceed without" — the input box stays
 * disabled either way, but only the latter shows the permission card.
 */
export const AgentSessionStatusSchema = z.enum([
  "connecting",
  "idle",
  "busy",
  "waiting_permission",
  "ended",
  "failed",
]);
export type AgentSessionStatus = z.infer<typeof AgentSessionStatusSchema>;

/** One option ACP offered for a permission request — `kind` is a UI hint, not a guarantee. */
export const AgentPermissionOptionVOSchema = z.object({
  optionId: z.string(),
  name: z.string(),
  kind: z.string().optional(),
});
export type AgentPermissionOptionVO = z.infer<typeof AgentPermissionOptionVOSchema>;

export const AgentPermissionRequestVOSchema = z.object({
  requestId: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  options: z.array(AgentPermissionOptionVOSchema),
});
export type AgentPermissionRequestVO = z.infer<typeof AgentPermissionRequestVOSchema>;

export const AgentSessionVOSchema = z.object({
  /** Busabase's own id for the session; not the agent's ACP sessionId. */
  id: z.string(),
  slug: z.string(),
  agentName: z.string(),
  transport: AgentTransportSchema,
  status: AgentSessionStatusSchema,
  /** ISO 8601 — never a Date at the transport boundary. */
  createdAt: z.string(),
  lastActivityAt: z.string(),
  /** Set when status is "failed"; surfaced verbatim to the user. */
  error: z.string().nullable().default(null),
});
export type AgentSessionVO = z.infer<typeof AgentSessionVOSchema>;

/**
 * One streamed event from a session.
 *
 * `acpUpdate` carries the agent's own `session/update` payload near-verbatim as
 * unknown-shaped JSON: ACP v1 and v2 disagree on its inner shape and agents
 * straddle both, so re-validating it here would reject traffic that is
 * perfectly good. The client renders what it recognises and ignores the rest.
 *
 * `permissionRequest`/`permissionResolved` are deliberately their own `kind`,
 * not smuggled into `acpUpdate` — ACP's `session/request_permission` is a
 * request the AGENT makes of the CLIENT (the reverse direction from every
 * `session/update` notification), so pretending it were an update would
 * misdescribe the protocol, not just the UI.
 */
export const AgentSessionEventVOSchema = z.object({
  sessionId: z.string(),
  /** Monotonic per session, so a reconnecting client can tell what it missed. */
  seq: z.number().int(),
  kind: z.enum(["acpUpdate", "status", "error", "permissionRequest", "permissionResolved"]),
  acpUpdate: z.unknown().optional(),
  status: AgentSessionStatusSchema.optional(),
  message: z.string().optional(),
  permissionRequest: AgentPermissionRequestVOSchema.optional(),
  /** Present on a `permissionResolved` event — which request, and what the user picked. */
  permissionRequestId: z.string().optional(),
  permissionOptionId: z.string().optional(),
  at: z.string(),
});
export type AgentSessionEventVO = z.infer<typeof AgentSessionEventVOSchema>;

// ── Inputs (DTO) ─────────────────────────────────────────────────────────────

export const CreateAgentSessionInputSchema = z.object({
  /** Must name a catalog entry. Deliberately NOT a command line — see below. */
  slug: z.string().min(1),
});
export type CreateAgentSessionInput = z.infer<typeof CreateAgentSessionInputSchema>;

export const PromptAgentSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1),
});
export type PromptAgentSessionInput = z.infer<typeof PromptAgentSessionInputSchema>;

export const AgentSessionIdInputSchema = z.object({ sessionId: z.string().min(1) });
export type AgentSessionIdInput = z.infer<typeof AgentSessionIdInputSchema>;

export const RespondToAgentPermissionInputSchema = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  optionId: z.string().min(1),
});
export type RespondToAgentPermissionInput = z.infer<typeof RespondToAgentPermissionInputSchema>;
