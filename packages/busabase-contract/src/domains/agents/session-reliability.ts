import { z } from "zod";

/** Stable admission identity, independent of a transport's JSON-RPC request id. */
export const AgentSessionCommandIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
export const AgentSessionCommandKindSchema = z.enum([
  "prompt",
  "config",
  "cancel",
  "permission",
  "input",
  "close",
]);
export type AgentSessionCommandKind = z.infer<typeof AgentSessionCommandKindSchema>;
export const AgentSessionCommandStateSchema = z.enum([
  "queued",
  "claimed",
  "dispatching",
  "observed",
  "completed",
  "rejected",
  "unknown",
]);
export type AgentSessionCommandState = z.infer<typeof AgentSessionCommandStateSchema>;

/** Payloads are immutable, authorized snapshots, never credentials or a PO. */
export const AgentSessionCommandReceiptVOSchema = z.object({
  commandId: AgentSessionCommandIdSchema,
  kind: AgentSessionCommandKindSchema,
  state: AgentSessionCommandStateSchema,
  payload: z.record(z.string(), z.unknown()),
  presentation: z.record(z.string(), z.unknown()).optional(),
  targetCommandId: AgentSessionCommandIdSchema.optional(),
  createdAt: z.string(),
  expiresAt: z.string(),
  errorCode: z.string().max(80).optional(),
});
export type AgentSessionCommandReceiptVO = z.infer<typeof AgentSessionCommandReceiptVOSchema>;

/** Orthogonal product states; storage trouble is not proof a remote run failed. */
export const AgentSessionReliabilityVOSchema = z.object({
  connection: z.enum(["connecting", "connected", "disconnected"]),
  execution: z.enum(["idle", "reserved", "running", "waiting", "terminal", "unknown"]),
  synchronization: z.enum(["synced", "recovering", "degraded", "gap"]),
  diagnosticRef: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
});
export type AgentSessionReliabilityVO = z.infer<typeof AgentSessionReliabilityVOSchema>;

/** Isolated generic-v1 history view, never treated as deduplicated journal rows. */
export const AgentSessionRecoverySnapshotVOSchema = z.object({
  capturedAt: z.string(),
  complete: z.boolean(),
  truncated: z.boolean(),
  updates: z.array(z.record(z.string(), z.unknown())).max(500),
});
export type AgentSessionRecoverySnapshotVO = z.infer<typeof AgentSessionRecoverySnapshotVOSchema>;
