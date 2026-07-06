import { z } from "zod";
// Records embed the kernel commit VO. This is a one-way import — the kernel
// contract never imports record schemas — so there is no cycle and no z.lazy.
import { commitSchema } from "../../../contract/schemas";
import { baseSchema } from "./base-schemas";

export const recordSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  headCommitId: z.string(),
  parentRecordId: z.string().nullable(),
  parentCommitId: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  createdBy: z.string(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  base: baseSchema,
  headCommit: commitSchema,
});

export const listRecordsInputSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    baseId: z.string().optional(),
    /** Opaque base64 cursor (`createdAt:id`) for keyset pagination. */
    cursor: z.string().optional(),
  })
  .optional()
  .default({ limit: 50 });

export const listRecordsResponseSchema = z.object({
  records: z.array(recordSchema),
  nextCursor: z.string().nullable(),
});

export const createChangeRequestInputSchema = z.object({
  fields: z
    .record(z.string(), z.unknown())
    .describe(
      "Record field values keyed by field slug. The base's PRIMARY field (its first field) becomes the record's display name and the change request title everywhere — always give it a short, human-readable value, never an id or placeholder.",
    ),
  message: z
    .string()
    .optional()
    .default("Initial change request")
    .describe(
      'Explanation shown to the human reviewer. Write a conventional-commit style subject — imperative verb + what + why, e.g. "Add Acme Corp — qualified lead from the June webinar".',
    ),
  submittedBy: z.string().optional().default("local-producer"),
});

export const createBulkChangeRequestInputSchema = z.object({
  records: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(1000)
    .describe(
      "Field-value maps, one per record to create, each keyed by field slug. All records are proposed as a SINGLE change request (one review, one merge) — use this to import/seed many rows at once instead of one change request per record. Capped at 1000; for very large loads prefer a dedicated import job. Always give each record's PRIMARY field a short human-readable value.",
    ),
  message: z
    .string()
    .optional()
    .default("Bulk create records")
    .describe(
      'Explanation shown to the human reviewer for the whole batch — e.g. "Import 240 June webinar leads".',
    ),
  submittedBy: z.string().optional().default("local-producer"),
});

export const recordFieldFilterInputSchema = z.object({
  baseId: z.string().optional(),
  fieldSlug: z.string().min(1),
  valueText: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const restoreRecordInputSchema = z.object({
  message: z.string().optional(),
  submittedBy: z.string().optional().default("local-editor"),
});

export const recordLinkSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  fieldId: z.string(),
  fieldSlug: z.string(),
  sourceRecordId: z.string(),
  targetBaseId: z.string(),
  targetRecordId: z.string(),
  commitId: z.string(),
  position: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
