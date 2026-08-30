import type { SessionUpdate, ToolCallStatus, ToolKind } from "@agentclientprotocol/sdk";

/**
 * The renderable view model for an ACP conversation.
 *
 * Deliberately *not* the AI SDK's `UIMessage`. ACP's permission requests carry a
 * list of options that a boolean `approved` cannot express, and 8 of ACP's 13
 * `sessionUpdate` kinds have no native `UIMessage` part.
 *
 * Fidelity is set by the higher-fidelity of the two implementations this
 * replaces (acprouter's): thoughts stay distinguishable from replies, and tool
 * calls keep their real status instead of being flattened to a text line.
 */
export type AcpBlock = AcpMessageBlock | AcpToolCallBlock | AcpPermissionBlock | AcpNoteBlock;

/**
 * Something attached to a message — either the agent sent one (an ACP
 * `image`/`audio`/`resource` content block arrived mid-message) or the user
 * attached one when sending.
 *
 * `file` covers everything a file picker produces that isn't an image or an
 * audio clip: a PDF, a spreadsheet, a Markdown note, a source file. It maps to
 * ACP's embedded `resource` content block, which the protocol calls the
 * "preferred" way to include context precisely because the agent has no other
 * route to a file the user picked in a browser. (ACP's *other* resource block,
 * `resource_link`, is a different UX — it names a path the agent can already
 * read, closer to an `@mention` picker than an attach button — and remains out
 * of scope.)
 *
 * `data` is ALWAYS base64, for every kind, so the browser never has to guess
 * an encoding and binary payloads can't be corrupted in transit. Whether a
 * `file` reaches the agent as ACP text or as an ACP blob is decided at send
 * time from the payload itself — see `prompt/attachment-media.ts`.
 */
export interface AcpAttachment {
  kind: "image" | "audio" | "file";
  /**
   * Base64-encoded payload. Verbatim from ACP's `ImageContent`/`AudioContent`
   * for those kinds; for `file`, base64 of the raw bytes regardless of whether
   * the file is textual.
   */
  data: string;
  mimeType: string;
  /**
   * The original filename. Only carried for `kind: "file"`, where it is what
   * the user recognises the attachment by — two PDFs are otherwise
   * indistinguishable in the composer — and what becomes the resource's `uri`.
   */
  filename?: string;
}

export interface AcpMessageBlock {
  kind: "message";
  id: string;
  role: "user" | "agent";
  /**
   * `thought` is the agent's reasoning (`agent_thought_chunk`), rendered
   * distinctly from its actual reply. busabase's implementation merged the two
   * into one role and lost this distinction; acprouter kept it.
   */
  variant: "message" | "thought";
  text: string;
  /**
   * Images/audio seen in this message's content blocks, in arrival order.
   * Additive and optional on purpose: most messages have none, and every
   * existing reader of `.text` keeps working unmodified.
   */
  attachments?: AcpAttachment[];
  /**
   * ACP's own grouping key: "All chunks belonging to the same message share the
   * same `messageId`. A change in `messageId` indicates a new message has
   * started." Absent on agents that don't send it, in which case the reducer
   * falls back to merging by (role, variant) adjacency.
   */
  messageId?: string;
}

export interface AcpToolCallBlock {
  kind: "tool_call";
  /** The ACP `toolCallId`. Keying on this is what makes repeated
   * `tool_call_update`s collapse into one block instead of six identical rows. */
  id: string;
  title: string;
  toolKind: ToolKind | null;
  status: ToolCallStatus;
}

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind?: string;
}

/**
 * `pending` → awaiting the user. `answering` → the user clicked and the answer
 * is in flight (lets the UI disable the buttons before the round trip
 * completes). `{ optionId }` → resolved.
 */
export type AcpPermissionResolution = "pending" | "answering" | { optionId: string };

export interface AcpPermissionBlock {
  kind: "permission";
  id: string;
  title: string;
  /** Kept as a list — the whole reason this view model is not `UIMessage`. */
  options: AcpPermissionOption[];
  /**
   * Optional on purpose: acprouter times permissions out after 5 minutes,
   * busabase waits indefinitely and deliberately never auto-approves. The core
   * must express both rather than hard-coding one.
   */
  timeoutAt?: string;
  resolution: AcpPermissionResolution;
}

/** Session-level messages that aren't part of the conversation (busabase uses these). */
export interface AcpNoteBlock {
  kind: "note";
  id: string;
  text: string;
  /** Set when the note explains why the session stopped. */
  ended?: boolean;
}

/**
 * What the reducer consumes. `session_update` wraps ACP's own union verbatim;
 * the rest are client-side events ACP models as JSON-RPC requests/responses
 * rather than session updates, plus one host-level event (`note`).
 */
export type AcpUiEvent =
  | { type: "session_update"; update: SessionUpdate }
  | {
      type: "permission_request";
      requestId: string;
      title: string;
      options: AcpPermissionOption[];
      timeoutAt?: string;
    }
  | { type: "permission_answering"; requestId: string }
  | { type: "permission_resolved"; requestId: string; optionId: string }
  | { type: "note"; text: string; ended?: boolean };
