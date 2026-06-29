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
  fields: z.record(z.string(), z.unknown()),
  message: z.string().optional().default("Initial change request"),
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
