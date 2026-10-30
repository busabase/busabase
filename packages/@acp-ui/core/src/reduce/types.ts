import type {
  ContentBlock,
  PlanEntry,
  SessionUpdate,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolKind,
} from "@agentclientprotocol/sdk";

/** Host-neutral, serializable ACP presentation state. */
export type AcpBlock =
  | AcpMessageBlock
  | AcpToolCallBlock
  | AcpPermissionBlock
  | AcpInputBlock
  | AcpPlanBlock
  | AcpTurnBlock
  | AcpStepBlock
  | AcpResourceBlock
  | AcpJobBlock
  | AcpNoteBlock;

export interface AcpBlockContext {
  turnId?: string;
  stepId?: string;
}

/** Composer payloads remain base64, including UTF-8 text files. */
export interface AcpAttachment {
  kind: "image" | "audio" | "file";
  data: string;
  mimeType: string;
  filename?: string;
  /** Original embedded resource, including its identity and host display metadata. */
  resource?: Extract<ContentBlock, { type: "resource" }>;
}

/** Host-validated, immutable text context; its URI is an identity, never a fetch instruction. */
export interface AcpResourceContext {
  id: string;
  name: string;
  uri: string;
  mimeType: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface AcpMessageBlock extends AcpBlockContext {
  kind: "message";
  id: string;
  role: "user" | "agent";
  variant: "message" | "thought";
  text: string;
  attachments?: AcpAttachment[];
  /** Ordered ACP content, including resources and content annotations. */
  content?: ContentBlock[];
  messageId?: string;
  /** Message-scoped metadata, including late citation annotations. */
  _meta?: Record<string, unknown>;
}

export interface AcpToolCallBlock extends AcpBlockContext {
  kind: "tool_call";
  id: string;
  title: string;
  name?: string;
  toolKind: ToolKind | null;
  status: ToolCallStatus;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: ToolCallContent[];
  locations?: ToolCallLocation[];
  _meta?: Record<string, unknown>;
  /** Stable relationship, independent of later per-event transport metadata. */
  parentToolCallId?: string | null;
  /** An unfinished call was interrupted with its containing turn. */
  outcome?: "cancelled" | "interrupted";
}

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind?: string;
}

export type AcpPermissionResolution = "pending" | "answering" | "cancelled" | { optionId: string };

export interface AcpPermissionBlock extends AcpBlockContext {
  kind: "permission";
  id: string;
  title: string;
  options: AcpPermissionOption[];
  timeoutAt?: string;
  resolution: AcpPermissionResolution;
  submittedOptionId?: string;
  confirmationUnknown?: boolean;
  error?: string;
}

export interface AcpInputResponse {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}

export interface AcpInputBlock extends AcpBlockContext {
  kind: "input_request";
  id: string;
  message: string;
  requestedSchema: Record<string, unknown>;
  toolCallId?: string;
  resolution: "pending" | "answering" | AcpInputResponse;
  error?: string;
  submittedResponse?: AcpInputResponse;
  confirmationUnknown?: boolean;
}

export interface AcpPlanBlock extends AcpBlockContext {
  kind: "plan";
  id: string;
  entries: PlanEntry[];
}

export interface AcpTurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  thoughtTokens?: number;
}

export interface AcpTurnBlock {
  kind: "turn";
  id: string;
  startedAt: string;
  endedAt?: string;
  status: "running" | "completed" | "cancelled" | "failed" | "interrupted" | "limited" | "refused";
  stopReason?: string;
  usage?: AcpTurnUsage;
  label?: string;
}

export interface AcpStepBlock extends AcpBlockContext {
  kind: "step";
  id: string;
  startedAt: string;
  endedAt?: string;
  label?: string;
}

/** Stable resource identity. A host resolves remote URIs into authorized URLs. */
export interface AcpResource {
  id: string;
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
  size?: number;
  previewUri?: string;
  status?: string;
  _meta?: Record<string, unknown>;
}

export interface AcpResourceBlock extends AcpBlockContext {
  kind: "resource";
  id: string;
  resource: AcpResource;
}

export interface AcpJob {
  id: string;
  title: string;
  status: string;
  resourceIds?: string[];
  message?: string;
}

export interface AcpJobBlock extends AcpBlockContext {
  kind: "job";
  id: string;
  job: AcpJob;
}

/** Normalized lifecycle events; transport namespaces belong to the host adapter. */
export interface AcpLifecycleEvent {
  version: 1;
  type:
    | "turn_started"
    | "step_started"
    | "step_finished"
    | "turn_finished"
    | "resource_update"
    | "job_update";
  turnId: string;
  at: string;
  stepId?: string;
  label?: string;
  stopReason?: string;
  usage?: AcpTurnUsage;
  resource?: AcpResource;
  job?: AcpJob;
}

export interface AcpNoteBlock extends AcpBlockContext {
  kind: "note";
  id: string;
  text: string;
  ended?: boolean;
}

export type AcpUiEvent =
  | { type: "session_update"; update: SessionUpdate }
  | { type: "lifecycle"; event: AcpLifecycleEvent }
  /** The host lost the current observation; this does not end the session. */
  | { type: "interrupted"; at: string }
  | {
      type: "permission_request";
      requestId: string;
      title: string;
      options: AcpPermissionOption[];
      timeoutAt?: string;
    }
  | { type: "permission_answering"; requestId: string; optionId?: string }
  | { type: "permission_failed"; requestId: string; error: string; confirmationUnknown?: boolean }
  | { type: "permission_resolved"; requestId: string; optionId: string }
  | { type: "permission_cancelled"; requestId: string }
  | {
      type: "input_request";
      requestId: string;
      message: string;
      requestedSchema: Record<string, unknown>;
      toolCallId?: string;
    }
  | { type: "input_answering"; requestId: string; response?: AcpInputResponse }
  | ({ type: "input_resolved"; requestId: string } & AcpInputResponse)
  | { type: "input_failed"; requestId: string; error: string; confirmationUnknown?: boolean }
  | { type: "note"; text: string; ended?: boolean };
