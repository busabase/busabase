import { z } from "zod";
// The activity descriptor embeds full VO schemas (all client-safe, standalone
// zod) so the client can format each feed row with i18n exactly as the old
// client-side `buildActivityEvents` did — now server-paginated. This file is a
// leaf: it imports the kernel CR/audit schemas and the record schema, and nothing
// imports it back, so there is no contract cycle.
import { recordSchema } from "../domains/base/contract/record-schemas";
import { auditEventSchema, changeRequestSchema } from "./schemas";

/**
 * One activity-feed row, discriminated by `kind`. Each carries the VO(s) the
 * client needs to render its title/body/href:
 * - `change_request` — the CR "updated / opened / approved / merged" row.
 * - `operation` — one row per operation; `operationId` selects it within the CR.
 * - `record` — a record "updated / archived" row.
 * - `audit` — an audit-log row; `record` is the referenced record (for its href)
 *   when the event points at one, else null.
 */
export const activityItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("change_request"),
    timestamp: z.string(),
    changeRequest: changeRequestSchema,
  }),
  z.object({
    kind: z.literal("operation"),
    timestamp: z.string(),
    operationId: z.string(),
    changeRequest: changeRequestSchema,
  }),
  z.object({
    kind: z.literal("record"),
    timestamp: z.string(),
    record: recordSchema,
  }),
  z.object({
    kind: z.literal("audit"),
    timestamp: z.string(),
    auditEvent: auditEventSchema,
    record: recordSchema.nullable(),
  }),
]);

/** Keyset page request: opaque base64 cursor (`ts|kind|id`) + page size. */
export const listActivityPagedInputSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    cursor: z.string().optional(),
  })
  .optional()
  .default({ limit: 50 });

export const listActivityResponseSchema = z.object({
  items: z.array(activityItemSchema),
  nextCursor: z.string().nullable(),
});

export type ActivityItemVO = z.infer<typeof activityItemSchema>;
