/**
 * Agents domain — DTO (inputs) and VO (outputs) for driving EXTERNAL ACP agents.
 *
 * Standalone zod only: no drizzle, no `~/db`, no server imports. These types are
 * pulled into the browser bundle and the mobile client is generated from them.
 *
 * Vocabulary note: an "agent" here is a *backend we connect out to* (Claude Code,
 * Codex, a remote Buda agent), NOT one of Busabase's own nodes.
 */
import { z } from "zod";
import { userRefSchema } from "../../contract/schemas";
import { NodeIconSchema } from "../../types/node-icon";
import { PromptResourceContextListSchema } from "./prompt-context";

export const RouterOauthStartVOSchema = z.object({ redirectUrl: z.string() });
export const RouterOauthCallbackVOSchema = z.object({
  grantId: z.string(),
  acprouterSpaceName: z.string(),
});
export const RouterGrantVOSchema = z.object({ grantId: z.string(), spaceName: z.string() });
export const RouterEnrollmentInputSchema = z.object({
  grantId: z.string().min(1),
  enrollmentId: z.string().min(1),
});
export const RouterEnrollmentMintInputSchema = z.object({
  grantId: z.string().min(1),
  agentSlug: z.enum(["claude-acp", "codex-acp"]),
});
export const RouterEnrollmentMintVOSchema = z.object({
  enrollmentId: z.string(),
  command: z.string(),
  expiresAt: z.string(),
});
export const RouterEnrollmentStatusVOSchema = z.object({
  state: z.enum(["not_redeemed", "redeemed_offline", "online", "failed"]),
  machineId: z.string().optional(),
});
export const RouterEnrollmentCompleteInputSchema = RouterEnrollmentInputSchema.extend({
  agentSlug: z.enum(["claude-acp", "codex-acp"]),
});
export const RouterEnrollmentConnectionVOSchema = z.object({
  connectionSlug: z.string(),
  agentSlug: z.string(),
});
export type RouterOauthStartVO = z.infer<typeof RouterOauthStartVOSchema>;
export type RouterOauthCallbackVO = z.infer<typeof RouterOauthCallbackVOSchema>;
export type RouterGrantVO = z.infer<typeof RouterGrantVOSchema>;
export type RouterEnrollmentInput = z.infer<typeof RouterEnrollmentInputSchema>;
export type RouterEnrollmentMintInput = z.infer<typeof RouterEnrollmentMintInputSchema>;
export type RouterEnrollmentMintVO = z.infer<typeof RouterEnrollmentMintVOSchema>;
export type RouterEnrollmentStatusVO = z.infer<typeof RouterEnrollmentStatusVOSchema>;
export type RouterEnrollmentCompleteInput = z.infer<typeof RouterEnrollmentCompleteInputSchema>;
export type RouterEnrollmentConnectionVO = z.infer<typeof RouterEnrollmentConnectionVOSchema>;

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
  /** Whether this integration is listed for discovery but not available yet. */
  comingSoon: z.boolean().default(false),
  /** Human-readable reason when `available` is false — never a bare "failed". */
  unavailableReason: z.string().nullable().default(null),
  connectionRequired: z.boolean().default(false),
  connectedAgentName: z.string().nullable().default(null),
  connectedAgents: z
    .array(
      z.object({
        slug: z.string(),
        name: z.string(),
      }),
    )
    .default([]),
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
  /** Exact proposed operation, inspectable before a decision is sent. */
  toolCall: z.record(z.string(), z.unknown()).optional(),
});
export type AgentPermissionRequestVO = z.infer<typeof AgentPermissionRequestVOSchema>;

/** A form requested by the agent, distinct from tool execution authorization. */
export const AgentInputRequestVOSchema = z.object({
  requestId: z.string(),
  message: z.string(),
  requestedSchema: z.record(z.string(), z.unknown()),
  toolCallId: z.string().optional(),
});
export type AgentInputRequestVO = z.infer<typeof AgentInputRequestVOSchema>;

export const AgentInputResponseSchema = z.object({
  action: z.enum(["accept", "decline", "cancel"]),
  content: z.record(z.string(), z.unknown()).optional(),
});
export type AgentInputResponse = z.infer<typeof AgentInputResponseSchema>;

/** A resource descriptor, never an agent credential or a local machine file handle. */
export const AgentResourceVOSchema = z.object({
  id: z.string(),
  uri: z.string(),
  name: z.string(),
  mimeType: z.string().optional(),
  description: z.string().optional(),
  size: z.number().nonnegative().optional(),
  previewUri: z.string().optional(),
  status: z.string().optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
});
export type AgentResourceVO = z.infer<typeof AgentResourceVOSchema>;

export const AgentSessionSnapshotVOSchema = z.object({
  version: z.literal(1),
  agentId: z.string(),
  sessionId: z.string(),
  runtime: z.object({ runner: z.string(), model: z.string(), workdir: z.string() }),
  provenance: z
    .object({
      source: z.string().optional(),
      authorId: z.string().optional(),
      authorName: z.string().optional(),
    })
    .optional(),
  context: z
    .object({
      promptMode: z.string().optional(),
      workdir: z.string().optional(),
      channelLabel: z.string().optional(),
    })
    .optional(),
  views: z.array(
    z.object({
      kind: z.enum(["browser", "terminal"]),
      status: z.enum(["available", "unavailable"]),
      resource: AgentResourceVOSchema.optional(),
      message: z.string().optional(),
    }),
  ),
});
export type AgentSessionSnapshotVO = z.infer<typeof AgentSessionSnapshotVOSchema>;

/**
 * An advertised ACP select, reduced to what the UI
 * needs to render a picker: which value is selected, and what it can become.
 *
 * Deliberately not the raw ACP `SessionConfigOption` — that type carries a
 * `boolean` variant and grouped select options this domain has no use for,
 * and re-exporting it here would leak an SDK shape across the contract
 * boundary for a feature that only needs "id, current value, flat choices".
 */
export const AgentSessionConfigSelectVOSchema = z.object({
  /** The ACP `configId` to send back on `session/set_config_option`. */
  id: z.string(),
  name: z.string(),
  currentValue: z.string(),
  options: z.array(z.object({ value: z.string(), name: z.string() })),
});
export type AgentSessionConfigSelectVO = z.infer<typeof AgentSessionConfigSelectVOSchema>;
export const AgentSessionModelOptionVOSchema = AgentSessionConfigSelectVOSchema.extend({
  options: z.array(
    z.object({
      value: z.string(),
      name: z.string(),
      /** Agent-advertised capabilities/defaults, never a confirmed session selection. */
      thinking: AgentSessionConfigSelectVOSchema.optional(),
    }),
  ),
});
export type AgentSessionModelOptionVO = z.infer<typeof AgentSessionModelOptionVOSchema>;

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
  /**
   * Present only while the agent's `session/new` (or a later
   * `config_option_update`) has advertised a `category: "model"` select.
   * `null` for agents that offer no model choice, and for every session
   * loaded from history — a finished process cannot take a config change,
   * so there is nothing to render a picker for.
   */
  modelOption: AgentSessionModelOptionVOSchema.nullable().default(null),
  /** Model-dependent `category: "thought_level"` choices, confirmed by ACP. */
  thinkingOption: AgentSessionConfigSelectVOSchema.nullable().optional(),
});
export type AgentSessionVO = z.infer<typeof AgentSessionVOSchema>;

export const ListAgentSessionsPagedInputSchema = z.object({
  slug: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).optional(),
});
export type ListAgentSessionsPagedInput = z.infer<typeof ListAgentSessionsPagedInputSchema>;

export const AgentSessionsPageVOSchema = z.object({
  items: AgentSessionVOSchema.array(),
  nextCursor: z.string().nullable(),
});
export type AgentSessionsPageVO = z.infer<typeof AgentSessionsPageVOSchema>;

/** One connected agent backend visible in the requested workspace scope. */
export const AgentConnectionVOSchema = z.object({
  slug: z.string(),
  agentName: z.string(),
  transport: AgentTransportSchema,
  sessionCount: z.number().int().nonnegative(),
  latest: AgentSessionVOSchema.nullable(),
  /** Whether Busabase can start another conversation with this agent right now. */
  connected: z.boolean(),
  connectionState: z.enum(["ready", "activating", "disconnecting"]).optional(),
  /** Controls owner-only actions such as deleting the saved OAuth grant. */
  ownedByCurrentUser: z.boolean(),
});
export type AgentConnectionVO = z.infer<typeof AgentConnectionVOSchema>;

/** Display names are workspace labels, independent of the provider's agent identity. */
export const AgentConnectionNameSchema = z.string().trim().min(1).max(100);
export const AgentConnectionInputSchema = z.object({ slug: z.string().min(1) });
export const RenameAgentConnectionInputSchema = AgentConnectionInputSchema.extend({
  name: AgentConnectionNameSchema,
});
export type AgentConnectionInput = z.infer<typeof AgentConnectionInputSchema>;
export type RenameAgentConnectionInput = z.infer<typeof RenameAgentConnectionInputSchema>;
export const AgentConnectionDetailVOSchema = z.object({
  slug: z.string(),
  agentName: z.string(),
  provider: z.enum(["buda", "acprouter"]),
  providerAgentName: z.string(),
  agentId: z.string(),
  transport: AgentTransportSchema,
  status: z.enum(["saved", "activating", "disconnecting", "revoked"]),
  ownedByCurrentUser: z.boolean(),
  /**
   * The person who actually holds this saved connection — resolved from the
   * persisted owner (Buda vault row's `userId`, or the ACPRouter grant's
   * `busabaseActorId`), never inferred from the current viewer. Null when
   * that identity cannot be resolved to a known user; render a localized
   * "Unknown connector" fallback rather than substituting the viewer.
   */
  connectedBy: userRefSchema.nullable().optional().default(null),
  routerWorkspaceName: z.string().optional(),
  routerWorkspaceId: z.string().optional(),
  deviceId: z.string().optional(),
});
export type AgentConnectionDetailVO = z.infer<typeof AgentConnectionDetailVOSchema>;

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
  kind: z.enum([
    "acpUpdate",
    "acpExtension",
    "status",
    "error",
    "permissionRequest",
    "permissionResolved",
    "inputRequest",
    "inputResolved",
  ]),
  acpUpdate: z.unknown().optional(),
  /** Preserve extension envelopes even when this client cannot render them yet. */
  acpExtension: z.object({ method: z.string(), params: z.unknown() }).optional(),
  status: AgentSessionStatusSchema.optional(),
  message: z.string().optional(),
  permissionRequest: AgentPermissionRequestVOSchema.optional(),
  /** Present on a `permissionResolved` event — which request, and what the user picked. */
  permissionRequestId: z.string().optional(),
  permissionOptionId: z.string().optional(),
  inputRequest: AgentInputRequestVOSchema.optional(),
  inputRequestId: z.string().optional(),
  inputResponse: AgentInputResponseSchema.optional(),
  at: z.string(),
});
export type AgentSessionEventVO = z.infer<typeof AgentSessionEventVOSchema>;

// ── Inputs (DTO) ─────────────────────────────────────────────────────────────

export const AgentConnectionScopeSchema = z.enum(["mine", "space"]);
export type AgentConnectionScope = z.infer<typeof AgentConnectionScopeSchema>;

export const ListAgentConnectionsInputSchema = z.object({
  scope: AgentConnectionScopeSchema.default("mine"),
});
export type ListAgentConnectionsInput = z.infer<typeof ListAgentConnectionsInputSchema>;

export const CreateAgentSessionInputSchema = z.object({
  /** Must name a catalog entry. Deliberately NOT a command line — see below. */
  slug: z.string().min(1),
});
export type CreateAgentSessionInput = z.infer<typeof CreateAgentSessionInputSchema>;

export const RespondToAgentInputSchema = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  response: AgentInputResponseSchema,
});
export const ResolveAgentResourceInputSchema = z.object({
  sessionId: z.string().min(1),
  resource: AgentResourceVOSchema,
});

export const DisconnectAgentInputSchema = z.object({
  /** The exact connected-agent slug shown by the sessions/catalog surfaces. */
  slug: z.string().min(1),
});
export type DisconnectAgentInput = z.infer<typeof DisconnectAgentInputSchema>;

export const DeleteAgentHistoryInputSchema = z.object({
  /** Deletes only the current actor's sessions for this agent in the active space. */
  slug: z.string().min(1),
});
export type DeleteAgentHistoryInput = z.infer<typeof DeleteAgentHistoryInputSchema>;

/**
 * A base64 payload the browser attached.
 *
 * `image`/`audio` map to ACP's `ImageContent`/`AudioContent` verbatim; `file`
 * is everything else (a PDF, a spreadsheet, a Markdown note) and becomes an
 * ACP embedded `resource` block at send time. `data` is base64 for every kind
 * — including textual files — so the browser never has to guess an encoding;
 * whether a file travels to the agent as ACP text or as an ACP blob is decided
 * server-side from the payload itself.
 */
export const PromptAttachmentInputSchema = z.object({
  kind: z.enum(["image", "audio", "file"]),
  // ~15 MB of raw bytes once base64 is decoded. A backstop, not the real
  // limit: the composer caps files at 10 MB where it can tell the user why.
  // This only stops a hand-rolled request from turning one prompt into an
  // unbounded request body.
  data: z.string().min(1).max(20_000_000),
  mimeType: z.string().min(1),
  /** The original filename, carried for `file` so the agent and the transcript can name it. */
  filename: z.string().max(255).optional(),
});
export type PromptAttachmentInput = z.infer<typeof PromptAttachmentInputSchema>;

/**
 * Legacy display metadata for older clients and persisted messages.
 * New clients send explicit contextReferences with the user's unchanged text.
 * The full `text` remains the Agent's prompt. Never infer this from its wording:
 * a user can type or paste exactly the same text as an official context line.
 */
export const AgentPromptPresentationSchema = z.object({
  version: z.literal(1),
  source: z.literal("node-context"),
  /** Empty for an attachment-only message; absence means legacy full-text display. */
  text: z.string(),
});
export type AgentPromptPresentation = z.infer<typeof AgentPromptPresentationSchema>;
/**
 * A selected node, resolved and authorized by the server when this message is sent.
 *
 * `kind` defaults to `"reference"` — background material the agent should treat
 * as data, not instructions (the long-standing behavior). `"invocation"` is for
 * a Skill the user explicitly picked from the composer's "/" palette: the server
 * swaps in a wrapper that tells the agent to follow it, instead of the
 * anti-injection "treat as reference data" wording. Only `skill` nodes may be
 * marked `"invocation"`; any other node type is rejected rather than silently
 * downgraded, since picking a doc or Base from the palette can't happen today.
 */
export const AgentContextReferenceInputSchema = z.object({
  nodeId: z.string().min(1),
  kind: z.enum(["reference", "invocation"]).optional(),
});
export type AgentContextReferenceInput = z.infer<typeof AgentContextReferenceInputSchema>;

/** Immutable, client-safe snapshot of the context actually supplied to an agent. */
export const AgentContextResourceVOSchema = z.object({
  nodeId: z.string(),
  nodeType: z.string(),
  name: z.string(),
  slug: z.string(),
  icon: NodeIconSchema.nullable().optional(),
  /** Mirrors the request's `AgentContextReferenceInput.kind`; absent means `"reference"`. */
  kind: z.enum(["reference", "invocation"]).optional(),
  truncated: z.boolean(),
  uri: z.string(),
  mimeType: z.string(),
  text: z.string(),
  annotations: z.object({
    audience: z.array(z.enum(["user", "assistant"])),
    lastModified: z.string().optional(),
  }),
});
export type AgentContextResourceVO = z.infer<typeof AgentContextResourceVOSchema>;

export const PromptAgentSessionInputSchema = z
  .object({
    sessionId: z.string().min(1),
    // No longer `.min(1)`: an attachment with no caption is a valid prompt.
    // The refine below is what actually requires SOMETHING to send.
    text: z.string(),
    attachments: z.array(PromptAttachmentInputSchema).optional(),
    presentation: AgentPromptPresentationSchema.optional(),
    contextReferences: z.array(AgentContextReferenceInputSchema).max(10).optional(),
    resourceContext: PromptResourceContextListSchema.optional(),
  })
  .refine(
    (value) => {
      const hasContext =
        (value.attachments?.length ?? 0) > 0 ||
        (value.contextReferences?.length ?? 0) > 0 ||
        (value.resourceContext?.length ?? 0) > 0;
      return (
        (value.text.trim().length > 0 || hasContext) &&
        ((value.presentation?.text ?? value.text).trim().length > 0 || hasContext)
      );
    },
    { message: "A prompt needs text, an attachment, or context." },
  );
export type PromptAgentSessionInput = z.infer<typeof PromptAgentSessionInputSchema>;

export const AgentSessionIdInputSchema = z.object({ sessionId: z.string().min(1) });
export type AgentSessionIdInput = z.infer<typeof AgentSessionIdInputSchema>;

export const RespondToAgentPermissionInputSchema = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  optionId: z.string().min(1),
});
export type RespondToAgentPermissionInput = z.infer<typeof RespondToAgentPermissionInputSchema>;

/** Change the session's `category: "model"` config option via `session/set_config_option`. */
export const SetAgentSessionConfigOptionInputSchema = z.object({
  sessionId: z.string().min(1),
  configId: z.string().min(1),
  value: z.string().min(1),
});
export type SetAgentSessionConfigOptionInput = z.infer<
  typeof SetAgentSessionConfigOptionInputSchema
>;
