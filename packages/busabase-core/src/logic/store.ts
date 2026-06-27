import "server-only";

import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getContextSpaceId, LOCAL_SPACE_ID, resolveActorId } from "../context";
import type { AuthInfo } from "../contract/schemas";
import { getDb } from "../db";
import type { BusabaseNodeType } from "../db/schema";
import {
  type AuditEventPO,
  type BaseFieldPO,
  type BasePO,
  busabaseAuditEvents,
  busabaseBaseFields,
  busabaseBases,
  busabaseChangeRequests,
  busabaseComments,
  busabaseCommits,
  busabaseFieldValues,
  busabaseNodes,
  busabaseOperations,
  busabaseRecordLinks,
  busabaseRecords,
  busabaseReviews,
  busabaseViews,
  type ChangeRequestPO,
  type CommentPO,
  type CommitPO,
  type NodePO,
  type OperationPO,
  type RecordLinkPO,
  type RecordPO,
  type ReviewPO,
  type ViewPO,
} from "../db/schema";
import { buildRecordSeedFields } from "../demo/dataset";
import type { SeedScenario } from "../demo/seed-types";
import {
  mergeBaseAddField,
  mergeRecordCreate,
  mergeRecordDelete,
  mergeRecordUpdate,
  mergeViewCreate,
  mergeViewDelete,
  mergeViewUpdate,
} from "../domains/base/handlers";
import { mergeDocUpdate } from "../domains/doc/handlers";
import { CREATABLE_NODE_TYPES } from "../domains/registry";
import { mergeSkillFile, mergeSkillMetadata } from "../domains/skill/handlers";
import { skillStoragePrefix, writeSkillTextFile } from "../domains/skill/logic/storage";
import type {
  AuditAction,
  AuditEventVO,
  BaseFieldVO,
  BaseVO,
  ChangeRequestStatus,
  ChangeRequestVO,
  CommentSubjectType,
  CommentVO,
  CommitVO,
  FieldType,
  NodeVO,
  OperationKind,
  OperationStatus,
  OperationVO,
  RecordLinkVO,
  RecordVO,
  ReviewVO,
  SearchResponseVO,
  SearchResultVO,
  ViewConfigVO,
  ViewFilterVO,
  ViewSortVO,
  ViewVO,
} from "../types";

/**
 * Per-space root node id. The local (open-source) tenant keeps the legacy fixed
 * id so its seed data and node references are unchanged; every cloud space gets
 * its own derived root so node trees never collide across spaces.
 */
import {
  CURRENT_USER_ID,
  hashText,
  id,
  now,
  ROOT_NODE_ID,
  requireBaseId,
  rootNodeIdForSpace,
} from "./kernel";
import { getMaterializer, type MaterializeArgs, type NodeCreateFields } from "./materialize";

const SKILLS_FOLDER_NODE_ID = "nod_skills";
const SEED_RESEARCH_SKILL_NODE_ID = "nod_skill_ai_research_editor";
const SEED_SKILL_CHANGE_REQUEST_ID = "crq_seed_skill_research_editor";
const SEED_SKILL_OPERATION_ID = "opr_seed_skill_research_editor";
const SEED_SKILL_COMMIT_ID = "cmt_seed_skill_research_editor";

const fieldTypeSchema = z.enum([
  "text",
  "longtext",
  "markdown",
  "html",
  "attachment",
  "relation",
  "number",
  "date",
  "checkbox",
  "select",
  "multiselect",
  "url",
  "email",
  "phone",
  "created_time",
  "updated_time",
  "created_by",
  "updated_by",
  "auto_number",
  "ai_summary",
  "ai_tags",
  "code",
]);

const fieldOptionsSchema = z
  .object({
    ai: z
      .object({
        model: z.string().optional(),
        prompt: z.string().optional(),
        reviewRequired: z.boolean().optional(),
        sourceFieldIds: z.array(z.string()).optional(),
      })
      .optional(),
    choices: z
      .array(
        z.object({
          color: z.string().optional(),
          id: z.string(),
          name: z.string(),
        }),
      )
      .optional(),
    code: z
      .object({
        language: z.string().optional(),
      })
      .optional(),
    inverseFieldId: z.string().optional(),
    multiple: z.boolean().optional(),
    number: z
      .object({
        format: z.enum(["plain", "currency"]).optional(),
        currency: z.string().optional(),
        locale: z.string().optional(),
      })
      .optional(),
    targetBaseId: z.string().optional(),
  })
  .default({});

export const fieldSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  type: fieldTypeSchema.default("text"),
  required: z.boolean().default(false),
  options: fieldOptionsSchema.optional().default({}),
});

export const createBaseInputSchema = z.object({
  parentNodeId: z.string().optional(),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().optional().default(""),
  fields: z.array(fieldSchema).min(1),
});

const nodeOperationInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    parentNodeId: z.string().optional(),
    nodeType: z.enum(CREATABLE_NODE_TYPES),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    description: z.string().optional().default(""),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
    // Base fields (nodeType "base" only); a base needs at least one field.
    fields: z
      .array(
        z.object({
          slug: z
            .string()
            .min(1)
            .regex(/^[a-z0-9-]+$/),
          name: z.string().min(1),
          type: fieldTypeSchema.default("text"),
          required: z.boolean().optional().default(false),
          options: fieldOptionsSchema.optional().default({}),
        }),
      )
      .optional(),
  }),
  z.object({
    kind: z.literal("rename"),
    nodeId: z.string(),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
  }),
  z.object({
    kind: z.literal("delete"),
    nodeId: z.string(),
  }),
  z.object({
    kind: z.literal("move"),
    nodeId: z.string(),
    parentNodeId: z.string(),
    position: z.number().int().optional(),
  }),
]);

export const createNodeChangeRequestInputSchema = z.object({
  message: z.string().optional().default("Update node tree"),
  submittedBy: z.string().optional().default("local-producer"),
  operations: z.array(nodeOperationInputSchema).min(1),
});

const viewFilterOperatorSchema = z.enum([
  "contains",
  "equals",
  "not_empty",
  "is_empty",
  "is_true",
  "is_false",
]);

const viewFilterSchema = z.object({
  fieldSlug: z.string().min(1),
  operator: viewFilterOperatorSchema,
  value: z.unknown().optional(),
});

const viewSortSchema = z.object({
  direction: z.enum(["asc", "desc"]),
  fieldSlug: z.string().min(1),
});

export const viewConfigSchema = z
  .object({
    filters: z.array(viewFilterSchema).optional().default([]),
    sorts: z.array(viewSortSchema).optional().default([]),
    visibleFieldSlugs: z.array(z.string()).nullable().optional(),
  })
  .optional()
  .default({ filters: [], sorts: [] });

export const createViewInputSchema = z.object({
  config: viewConfigSchema,
  description: z.string().optional().default(""),
  message: z.string().optional().default("Create view"),
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  submittedBy: z.string().optional().default("local-producer"),
});

export const updateViewInputSchema = z.object({
  config: viewConfigSchema.optional(),
  description: z.string().optional(),
  message: z.string().optional().default("Update view"),
  name: z.string().min(1).optional(),
  submittedBy: z.string().optional().default("local-producer"),
});

export const deleteViewInputSchema = z.object({
  message: z.string().optional().default("Delete view"),
  submittedBy: z.string().optional().default("local-producer"),
});

export const createChangeRequestInputSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  message: z.string().optional().default("Initial changeRequest"),
  submittedBy: z.string().optional().default("local-producer"),
});

export const createDeleteChangeRequestInputSchema = z.object({
  message: z.string().optional().default("Delete record"),
  submittedBy: z.string().optional().default("local-producer"),
  deleteMode: z.enum(["archive", "hard_delete_after_retention"]).optional().default("archive"),
});

export const reviseOperationInputSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  message: z.string().optional().default("Revise operation"),
  author: z.string().optional().default("local-producer"),
});

export const reviewInputSchema = z.object({
  verdict: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
});

export const auditEventInputSchema = z.object({
  action: z.enum([
    "record.viewed",
    "change_request.created",
    "change_request.updated",
    "change_request.deleted",
    "change_request.reviewed",
    "change_request.merged",
  ]),
  actorId: z.string().optional().default("local-viewer"),
  baseId: z.string().optional().nullable(),
  recordId: z.string().optional().nullable(),
  changeRequestId: z.string().optional().nullable(),
  operationId: z.string().optional().nullable(),
  commitId: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const commentSubjectInputSchema = z.object({
  subjectType: z.enum(["record", "change_request", "operation", "commit"]),
  subjectId: z.string().min(1),
});

export const createCommentInputSchema = commentSubjectInputSchema.extend({
  authorId: z.string().optional().default(CURRENT_USER_ID),
  body: z.string().trim().min(1),
  mentionsAi: z.boolean().optional().default(false),
});

export const listInputSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional().default(50),
  })
  .optional()
  .default({ limit: 50 });

export const recordFieldFilterInputSchema = z.object({
  baseId: z.string().optional(),
  fieldSlug: z.string().min(1),
  valueText: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional().default(50),
});

export const searchInputSchema = z.object({
  query: z.string().default(""),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

const toIso = (date: Date | null) => (date ? date.toISOString() : null);
const minutesBefore = (date: Date, minutes: number) => new Date(date.getTime() - minutes * 60_000);

const globalForStore = globalThis as typeof globalThis & {
  /** Per-space readiness, so each space bootstraps its root exactly once. */
  __busabaseReadyBySpace?: Map<string, Promise<void>>;
};

export const toFieldVO = (field: BaseFieldPO): BaseFieldVO => ({
  id: field.id,
  baseId: field.baseId,
  slug: field.slug,
  name: field.name,
  type: field.type as FieldType,
  required: field.required,
  position: field.position,
  options: field.options ?? {},
});

export const toBaseVO = (base: BasePO, fields: BaseFieldPO[]): BaseVO => ({
  id: base.id,
  nodeId: base.nodeId,
  slug: base.slug,
  name: base.name,
  description: base.description,
  reviewPolicy: base.reviewPolicy,
  createdAt: base.createdAt.toISOString(),
  fields: fields.sort((a, b) => a.position - b.position).map(toFieldVO),
});

export const normalizeViewConfig = (config: ViewPO["config"] | ViewConfigVO): ViewConfigVO => ({
  filters: (config.filters ?? []) as ViewFilterVO[],
  sorts: (config.sorts ?? []) as ViewSortVO[],
  visibleFieldSlugs: config.visibleFieldSlugs,
});

export const toViewVO = (view: ViewPO): ViewVO => ({
  id: view.id,
  baseId: view.baseId,
  slug: view.slug,
  name: view.name,
  description: view.description,
  type: "table",
  config: normalizeViewConfig(view.config),
  status: view.status === "archived" ? "archived" : "active",
  createdBy: view.createdBy,
  archivedAt: toIso(view.archivedAt),
  createdAt: view.createdAt.toISOString(),
  updatedAt: view.updatedAt.toISOString(),
});

export const toNodeVO = (node: NodePO, baseId: string | null, children: NodeVO[] = []): NodeVO => ({
  id: node.id,
  parentId: node.parentId,
  type: node.type,
  slug: node.slug,
  name: node.name,
  description: node.description,
  metadata: node.metadata ?? {},
  position: node.position,
  createdAt: node.createdAt.toISOString(),
  updatedAt: node.updatedAt.toISOString(),
  baseId,
  children,
});

const buildNodeTree = (nodes: NodePO[], bases: BasePO[]): NodeVO[] => {
  const baseIdByNodeId = new Map(bases.map((base) => [base.nodeId, base.id]));
  const childrenByParentId = new Map<string | null, NodePO[]>();
  for (const node of nodes) {
    const siblings = childrenByParentId.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParentId.set(node.parentId, siblings);
  }

  const sortNodes = (items: NodePO[]) =>
    items.sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());

  const hydrate = (node: NodePO): NodeVO =>
    toNodeVO(
      node,
      baseIdByNodeId.get(node.id) ?? null,
      sortNodes(childrenByParentId.get(node.id) ?? []).map(hydrate),
    );

  return sortNodes(childrenByParentId.get(null) ?? []).map(hydrate);
};

const toCommitVO = (commit: CommitPO): CommitVO => ({
  id: commit.id,
  baseId: commit.baseId,
  targetType: commit.targetType,
  nodeId: commit.nodeId,
  operationId: commit.operationId,
  parentCommitId: commit.parentCommitId,
  fields: commit.fields,
  operation: commit.operation as OperationKind,
  message: commit.message,
  author: commit.author,
  createdAt: commit.createdAt.toISOString(),
});

const toReviewVO = (review: ReviewPO): ReviewVO => ({
  id: review.id,
  changeRequestId: review.changeRequestId,
  reviewerId: review.reviewerId,
  verdict: review.verdict,
  reason: review.reason,
  visibleOperationHeads: review.visibleOperationHeads,
  createdAt: review.createdAt.toISOString(),
});

const toCommentVO = (comment: CommentPO): CommentVO => ({
  id: comment.id,
  subjectType: comment.subjectType as CommentSubjectType,
  subjectId: comment.subjectId,
  recordId: comment.recordId,
  changeRequestId: comment.changeRequestId,
  operationId: comment.operationId,
  commitId: comment.commitId,
  authorId: comment.authorId,
  body: comment.body,
  mentionsAi: comment.mentionsAi,
  createdAt: comment.createdAt.toISOString(),
  updatedAt: comment.updatedAt.toISOString(),
});

const toAuditEventVO = (event: AuditEventPO): AuditEventVO => ({
  id: event.id,
  action: event.action as AuditAction,
  actorId: event.actorId,
  baseId: event.baseId,
  recordId: event.recordId,
  changeRequestId: event.changeRequestId,
  operationId: event.operationId,
  commitId: event.commitId,
  metadata: event.metadata,
  createdAt: event.createdAt.toISOString(),
});

export const toRecordLinkVO = (link: RecordLinkPO): RecordLinkVO => ({
  id: link.id,
  baseId: link.baseId,
  fieldId: link.fieldId,
  fieldSlug: link.fieldSlug,
  sourceRecordId: link.sourceRecordId,
  targetBaseId: link.targetBaseId,
  targetRecordId: link.targetRecordId,
  commitId: link.commitId,
  position: link.position,
  createdAt: link.createdAt.toISOString(),
  updatedAt: link.updatedAt.toISOString(),
});

export const insertAuditEvent = async (
  db: Awaited<ReturnType<typeof getDb>>,
  input: z.infer<typeof auditEventInputSchema>,
) => {
  const parsed = auditEventInputSchema.parse(input);
  const [event] = await db
    .insert(busabaseAuditEvents)
    .values({
      id: id("aud"),
      action: parsed.action,
      // Cloud: attribute to the authenticated user (from context); open source:
      // keep the input's local default.
      actorId: resolveActorId(parsed.actorId),
      baseId: parsed.baseId ?? null,
      recordId: parsed.recordId ?? null,
      changeRequestId: parsed.changeRequestId ?? null,
      operationId: parsed.operationId ?? null,
      commitId: parsed.commitId ?? null,
      metadata: parsed.metadata,
      createdAt: now(),
    })
    .returning();
  return toAuditEventVO(event);
};

const resolveCommentSubject = async (
  db: Awaited<ReturnType<typeof getDb>>,
  subjectType: CommentSubjectType,
  subjectId: string,
) => {
  if (subjectType === "record") {
    const [record] = await db
      .select()
      .from(busabaseRecords)
      .where(eq(busabaseRecords.id, subjectId))
      .limit(1);
    if (!record) {
      throw new Error(`Record not found: ${subjectId}`);
    }
    return {
      commitId: record.headCommitId,
      changeRequestId: null,
      operationId: null,
      recordId: record.id,
    };
  }

  if (subjectType === "change_request") {
    const [changeRequest] = await db
      .select()
      .from(busabaseChangeRequests)
      .where(eq(busabaseChangeRequests.id, subjectId))
      .limit(1);
    if (!changeRequest) {
      throw new Error(`ChangeRequest not found: ${subjectId}`);
    }
    return {
      commitId: null,
      changeRequestId: changeRequest.id,
      operationId: null,
      recordId: null,
    };
  }

  if (subjectType === "operation") {
    const [operation] = await db
      .select()
      .from(busabaseOperations)
      .where(eq(busabaseOperations.id, subjectId))
      .limit(1);
    if (!operation) {
      throw new Error(`Operation not found: ${subjectId}`);
    }
    return {
      commitId: operation.headCommitId,
      changeRequestId: operation.changeRequestId,
      operationId: operation.id,
      recordId: operation.targetRecordId ?? operation.mergedRecordId,
    };
  }

  const [commit] = await db
    .select()
    .from(busabaseCommits)
    .where(eq(busabaseCommits.id, subjectId))
    .limit(1);
  if (!commit) {
    throw new Error(`Commit not found: ${subjectId}`);
  }
  return {
    commitId: commit.id,
    changeRequestId: null,
    operationId: commit.operationId,
    recordId: null,
  };
};

const toOperationVO = (
  item: OperationPO,
  headCommit: CommitPO,
  baseFields: Record<string, unknown> | null,
): OperationVO => ({
  id: item.id,
  changeRequestId: item.changeRequestId,
  baseId: item.baseId,
  targetType: item.targetType,
  nodeId: item.nodeId,
  operation: item.operation as OperationKind,
  status: item.status as OperationStatus,
  targetRecordId: item.targetRecordId,
  targetViewId: item.targetViewId,
  filePath: item.filePath,
  sourceRecordId: item.sourceRecordId,
  sourceCommitId: item.sourceCommitId,
  baseCommitId: item.baseCommitId,
  headCommitId: item.headCommitId,
  deleteMode:
    item.deleteMode === "hard_delete_after_retention" ? "hard_delete_after_retention" : "archive",
  mergedRecordId: item.mergedRecordId,
  mergedViewId: item.mergedViewId,
  position: item.position,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  headCommit: toCommitVO(headCommit),
  baseFields,
});

export const normalizeFieldValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return {};
  }
  if (typeof value === "string") {
    const maybeDate = new Date(value);
    return {
      valueText: value,
      valueDate: Number.isNaN(maybeDate.getTime()) ? null : maybeDate,
      valueHash: value.length > 256 ? `${value.length}:${value.slice(0, 128)}` : null,
    };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { valueText: String(value), valueNumber: value };
  }
  if (typeof value === "boolean") {
    return { valueText: String(value), valueBool: value };
  }

  let serialized = "";
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = String(value);
  }
  return {
    valueText: Array.isArray(value) ? value.join(", ") : null,
    valueJson: value,
    valueHash: serialized.slice(0, 256),
  };
};

export const getRelationRecordIds = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return [];
};

export const projectCommitFields = async (input: {
  baseId: string;
  commitId: string;
  changeRequestId?: string | null;
  operationId?: string | null;
  recordId?: string | null;
  fields: Record<string, unknown>;
}) => {
  const db = await getDb();
  const timestamp = now();
  const fieldRows = await db
    .select()
    .from(busabaseBaseFields)
    .where(eq(busabaseBaseFields.baseId, input.baseId));
  const fieldsBySlug = new Map(fieldRows.map((field) => [field.slug, field]));
  const sourceRecordId = input.recordId ?? null;
  const relationEntries = sourceRecordId
    ? Object.entries(input.fields).flatMap(([fieldSlug, value]) => {
        const field = fieldsBySlug.get(fieldSlug);
        if (!field || field.type !== "relation") {
          return [];
        }
        const targetBaseId =
          typeof field.options.targetBaseId === "string"
            ? field.options.targetBaseId
            : input.baseId;
        return getRelationRecordIds(value).map((targetRecordId, position) => ({
          id: id("rlk"),
          baseId: input.baseId,
          fieldId: field.id,
          fieldSlug,
          sourceRecordId,
          targetBaseId,
          targetRecordId,
          commitId: input.commitId,
          position,
          createdAt: timestamp,
          updatedAt: timestamp,
        }));
      })
    : [];
  const relationTargetIds = [...new Set(relationEntries.map((link) => link.targetRecordId))];
  const existingRelationTargetIds =
    relationTargetIds.length > 0
      ? new Set(
          (
            await db
              .select({ id: busabaseRecords.id })
              .from(busabaseRecords)
              .where(inArray(busabaseRecords.id, relationTargetIds))
          ).map((record) => record.id),
        )
      : new Set<string>();
  const relationLinks = relationEntries.filter((link) =>
    existingRelationTargetIds.has(link.targetRecordId),
  );
  const projectedValues = Object.entries(input.fields).flatMap(([fieldSlug, value]) => {
    const field = fieldsBySlug.get(fieldSlug);
    if (!field) {
      return [];
    }
    return [
      {
        id: id("fvl"),
        baseId: input.baseId,
        recordId: input.recordId ?? null,
        changeRequestId: input.changeRequestId ?? null,
        operationId: input.operationId ?? null,
        commitId: input.commitId,
        fieldId: field.id,
        fieldSlug,
        fieldType: field.type,
        ...normalizeFieldValue(value),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
  });

  if (projectedValues.length === 0) {
    if (relationLinks.length === 0) {
      return;
    }
  } else {
    await db.insert(busabaseFieldValues).values(projectedValues);
  }

  if (input.recordId) {
    const relationFieldSlugs = Object.entries(input.fields)
      .filter(([fieldSlug]) => fieldsBySlug.get(fieldSlug)?.type === "relation")
      .map(([fieldSlug]) => fieldSlug);
    if (relationFieldSlugs.length > 0) {
      await db
        .delete(busabaseRecordLinks)
        .where(
          and(
            eq(busabaseRecordLinks.sourceRecordId, input.recordId),
            inArray(busabaseRecordLinks.fieldSlug, relationFieldSlugs),
          ),
        );
    }
  }

  if (relationLinks.length > 0) {
    await db.insert(busabaseRecordLinks).values(relationLinks);
  }
};

export const projectCommitFieldsIfMissing = async (input: {
  baseId: string;
  commitId: string;
  changeRequestId?: string | null;
  operationId?: string | null;
  recordId?: string | null;
}) => {
  const db = await getDb();
  const projectionFilter = input.recordId
    ? eq(busabaseFieldValues.recordId, input.recordId)
    : input.operationId
      ? eq(busabaseFieldValues.operationId, input.operationId)
      : input.changeRequestId
        ? eq(busabaseFieldValues.changeRequestId, input.changeRequestId)
        : null;
  if (!projectionFilter) {
    return;
  }

  const existingProjection = await db
    .select()
    .from(busabaseFieldValues)
    .where(projectionFilter)
    .limit(1);
  if (existingProjection.length > 0 && !input.recordId) {
    return;
  }

  const [commit] = await db
    .select()
    .from(busabaseCommits)
    .where(eq(busabaseCommits.id, input.commitId))
    .limit(1);
  if (!commit) {
    return;
  }

  if (existingProjection.length > 0 && input.recordId) {
    const relationFieldRows = await db
      .select()
      .from(busabaseBaseFields)
      .where(
        and(eq(busabaseBaseFields.baseId, input.baseId), eq(busabaseBaseFields.type, "relation")),
      );
    const hasRelationValue = relationFieldRows.some((field) => Boolean(commit.fields[field.slug]));
    if (!hasRelationValue) {
      return;
    }
  }

  await projectCommitFields({ ...input, fields: commit.fields });
};

const ensureProjectionBackfill = async () => {
  const db = await getDb();
  const operationKindRows = await db.select().from(busabaseOperations);
  for (const item of operationKindRows) {
    if (!item.baseId) {
      continue;
    }
    await projectCommitFieldsIfMissing({
      baseId: item.baseId,
      commitId: item.headCommitId,
      changeRequestId: item.changeRequestId,
      operationId: item.id,
    });
  }

  const recordRows = await db.select().from(busabaseRecords);
  for (const record of recordRows) {
    await projectCommitFieldsIfMissing({
      baseId: record.baseId,
      commitId: record.headCommitId,
      recordId: record.id,
    });
  }
};

interface SeedRecordInput {
  id: string;
  baseId: string;
  commitId: string;
  fields: Record<string, unknown>;
  message: string;
  author: string;
  createdBy: string;
  createdAt: Date;
}

interface SeedOperationKindInput {
  id: string;
  commitId: string;
  operation: OperationKind;
  fields: Record<string, unknown>;
  message: string;
  author: string;
  targetRecordId?: string | null;
  targetViewId?: string | null;
  sourceRecordId?: string | null;
  sourceCommitId?: string | null;
  baseCommitId?: string | null;
  deleteMode?: "archive" | "hard_delete_after_retention";
}

interface SeedChangeRequestInput {
  id: string;
  baseId: string;
  status: ChangeRequestStatus;
  submittedBy: string;
  sourceMeta: Record<string, unknown>;
  createdAt: Date;
  reviewedAt?: Date | null;
  operations: SeedOperationKindInput[];
}

interface SeedNodeChangeRequestInput {
  id: string;
  nodeId: string;
  status: ChangeRequestStatus;
  submittedBy: string;
  sourceMeta: Record<string, unknown>;
  createdAt: Date;
  operation: {
    id: string;
    commitId: string;
    operation: OperationKind;
    filePath?: string | null;
    fields: Record<string, unknown>;
    message: string;
    author: string;
  };
}

interface SeedViewInput {
  id: string;
  baseId: string;
  slug: string;
  name: string;
  description: string;
  config: ViewConfigVO;
  createdAt: Date;
}

const seedViewIfMissing = async (input: SeedViewInput) => {
  const db = await getDb();
  const [existingView] = await db
    .select()
    .from(busabaseViews)
    .where(eq(busabaseViews.id, input.id))
    .limit(1);
  if (existingView) {
    await db
      .update(busabaseViews)
      .set({
        config: input.config,
        description: input.description,
        name: input.name,
        updatedAt: input.createdAt,
      })
      .where(eq(busabaseViews.id, input.id));
    return;
  }

  await db.insert(busabaseViews).values({
    id: input.id,
    baseId: input.baseId,
    slug: input.slug,
    name: input.name,
    description: input.description,
    type: "table",
    config: input.config,
    status: "active",
    createdBy: CURRENT_USER_ID,
    archivedAt: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
};

const seedRecordIfMissing = async (input: SeedRecordInput) => {
  const db = await getDb();
  const [existingRecord] = await db
    .select()
    .from(busabaseRecords)
    .where(eq(busabaseRecords.id, input.id))
    .limit(1);
  if (existingRecord) {
    await db
      .update(busabaseCommits)
      .set({ fields: input.fields })
      .where(eq(busabaseCommits.id, input.commitId));
    await projectCommitFields({
      baseId: input.baseId,
      commitId: input.commitId,
      recordId: input.id,
      fields: input.fields,
    });
    return;
  }

  await db.insert(busabaseCommits).values({
    id: input.commitId,
    baseId: input.baseId,
    operationId: null,
    parentCommitId: null,
    fields: input.fields,
    operation: "record_create",
    message: input.message,
    author: input.author,
    createdAt: input.createdAt,
  });

  await db.insert(busabaseRecords).values({
    id: input.id,
    baseId: input.baseId,
    headCommitId: input.commitId,
    parentRecordId: null,
    parentCommitId: null,
    status: "active",
    createdBy: input.createdBy,
    archivedAt: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });

  await projectCommitFields({
    baseId: input.baseId,
    commitId: input.commitId,
    recordId: input.id,
    fields: input.fields,
  });
};

const seedChangeRequestIfMissing = async (input: SeedChangeRequestInput) => {
  const db = await getDb();
  const [existingChangeRequest] = await db
    .select()
    .from(busabaseChangeRequests)
    .where(eq(busabaseChangeRequests.id, input.id))
    .limit(1);
  if (existingChangeRequest) {
    await Promise.all(
      input.operations.map(async (operation) => {
        await db
          .update(busabaseCommits)
          .set({ fields: operation.fields })
          .where(eq(busabaseCommits.id, operation.commitId));
        await projectCommitFields({
          baseId: input.baseId,
          commitId: operation.commitId,
          changeRequestId: input.id,
          operationId: operation.id,
          fields: operation.fields,
        });
      }),
    );
    return;
  }

  await db.insert(busabaseChangeRequests).values({
    id: input.id,
    baseId: input.baseId,
    status: input.status,
    submittedBy: input.submittedBy,
    sourceMeta: input.sourceMeta,
    reviewPolicySnapshot: { kind: "single", requiredApprovals: 1 },
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: input.reviewedAt ?? null,
    mergedAt: null,
    createdAt: input.createdAt,
    updatedAt: input.reviewedAt ?? input.createdAt,
  });

  const operationHeadById = new Map<string, string>();
  for (const [position, operation] of input.operations.entries()) {
    await db.insert(busabaseCommits).values({
      id: operation.commitId,
      baseId: input.baseId,
      operationId: null,
      parentCommitId: operation.baseCommitId ?? operation.sourceCommitId ?? null,
      fields: operation.fields,
      operation: operation.operation,
      message: operation.message,
      author: operation.author,
      createdAt: input.createdAt,
    });

    await db.insert(busabaseOperations).values({
      id: operation.id,
      changeRequestId: input.id,
      baseId: input.baseId,
      operation: operation.operation,
      status: "pending",
      targetRecordId: operation.targetRecordId ?? null,
      targetViewId: operation.targetViewId ?? null,
      sourceRecordId: operation.sourceRecordId ?? null,
      sourceCommitId: operation.sourceCommitId ?? null,
      baseCommitId: operation.baseCommitId ?? null,
      headCommitId: operation.commitId,
      deleteMode: operation.deleteMode ?? "archive",
      mergedRecordId: null,
      mergedViewId: null,
      position,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });

    await db
      .update(busabaseCommits)
      .set({ operationId: operation.id })
      .where(eq(busabaseCommits.id, operation.commitId));
    await projectCommitFields({
      baseId: input.baseId,
      commitId: operation.commitId,
      changeRequestId: input.id,
      operationId: operation.id,
      fields: operation.fields,
    });
    operationHeadById.set(operation.id, operation.commitId);
  }

  if (input.status === "approved") {
    await db.insert(busabaseReviews).values({
      id: `${input.id}_review`,
      changeRequestId: input.id,
      reviewerId: CURRENT_USER_ID,
      verdict: "approved",
      reason: null,
      visibleOperationHeads: Object.fromEntries(operationHeadById),
      createdAt: input.reviewedAt ?? input.createdAt,
    });
  }
};

const seedNodeChangeRequestIfMissing = async (input: SeedNodeChangeRequestInput) => {
  const db = await getDb();
  const [existingChangeRequest] = await db
    .select()
    .from(busabaseChangeRequests)
    .where(eq(busabaseChangeRequests.id, input.id))
    .limit(1);
  if (existingChangeRequest) {
    await db
      .update(busabaseCommits)
      .set({ fields: input.operation.fields })
      .where(eq(busabaseCommits.id, input.operation.commitId));
    return;
  }

  await db.insert(busabaseChangeRequests).values({
    id: input.id,
    baseId: null,
    targetType: "node",
    nodeId: input.nodeId,
    status: input.status,
    submittedBy: input.submittedBy,
    sourceMeta: input.sourceMeta,
    reviewPolicySnapshot: { kind: "single", requiredApprovals: 1 },
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });

  await db.insert(busabaseCommits).values({
    id: input.operation.commitId,
    baseId: null,
    targetType: "node",
    nodeId: input.nodeId,
    operationId: null,
    parentCommitId: null,
    fields: input.operation.fields,
    operation: input.operation.operation,
    message: input.operation.message,
    author: input.operation.author,
    createdAt: input.createdAt,
  });

  await db.insert(busabaseOperations).values({
    id: input.operation.id,
    changeRequestId: input.id,
    baseId: null,
    targetType: "node",
    nodeId: input.nodeId,
    operation: input.operation.operation,
    status: "pending",
    targetRecordId: null,
    targetViewId: null,
    filePath: input.operation.filePath ?? null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: null,
    headCommitId: input.operation.commitId,
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });

  await db
    .update(busabaseCommits)
    .set({ operationId: input.operation.id })
    .where(eq(busabaseCommits.id, input.operation.commitId));
};

const ensureDefaultStorageUrl = () => {
  process.env.STORAGE_URL ??= `local://${process.cwd()}/.data/busabase-storage?base_url=/api/storage`;
};

const seedSkillNodeIfMissing = async (createdAt: Date) => {
  ensureDefaultStorageUrl();
  const db = await getDb();
  const [existingFolder] = await db
    .select()
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, SKILLS_FOLDER_NODE_ID))
    .limit(1);
  if (!existingFolder) {
    await db.insert(busabaseNodes).values({
      id: SKILLS_FOLDER_NODE_ID,
      parentId: ROOT_NODE_ID,
      type: "folder",
      slug: "skills",
      name: "Agent Skills",
      description: "Versioned Skill folders that agents can read and update through review.",
      position: 1,
      createdAt,
      updatedAt: createdAt,
    });
  }

  const [existingSkill] = await db
    .select()
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, SEED_RESEARCH_SKILL_NODE_ID))
    .limit(1);
  const skillMetadata = {
    storagePrefix: skillStoragePrefix(SEED_RESEARCH_SKILL_NODE_ID),
    entryFile: "SKILL.md",
    visibility: "workspace" as const,
    version: "0.1.0",
  };
  if (existingSkill) {
    await db
      .update(busabaseNodes)
      .set({
        parentId: SKILLS_FOLDER_NODE_ID,
        type: "skill",
        slug: "ai-research-editor",
        name: "AI Research Editor",
        description: "Reviews agent research drafts for source quality before publishing.",
        metadata: skillMetadata,
        updatedAt: createdAt,
      })
      .where(eq(busabaseNodes.id, SEED_RESEARCH_SKILL_NODE_ID));
  } else {
    await db.insert(busabaseNodes).values({
      id: SEED_RESEARCH_SKILL_NODE_ID,
      parentId: SKILLS_FOLDER_NODE_ID,
      type: "skill",
      slug: "ai-research-editor",
      name: "AI Research Editor",
      description: "Reviews agent research drafts for source quality before publishing.",
      metadata: skillMetadata,
      position: 0,
      createdAt,
      updatedAt: createdAt,
    });
  }

  const [skillNode] = await db
    .select()
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, SEED_RESEARCH_SKILL_NODE_ID))
    .limit(1);
  if (!skillNode) {
    throw new Error("Failed to seed Skill node");
  }

  const skillMd = `---\nname: ai-research-editor\ndescription: Reviews agent research drafts for source quality before publishing.\n---\n\n# AI Research Editor\n\nUse this skill when an agent proposes AI industry analysis, newsletter copy, or social threads that need source checks before merge.\n\n## Workflow\n\n1. Read the proposed ChangeRequest operations.\n2. Check whether every factual claim has a source URL or a clear internal record reference.\n3. Flag unsupported claims before approval.\n4. Keep edits concise and preserve the author's thesis.\n`;
  await writeSkillTextFile(skillNode, "SKILL.md", skillMd);
  await writeSkillTextFile(
    skillNode,
    "skill.json",
    `${JSON.stringify(
      {
        name: "ai-research-editor",
        description: "Reviews agent research drafts for source quality before publishing.",
        version: "0.1.0",
      },
      null,
      2,
    )}\n`,
  );
  await writeSkillTextFile(
    skillNode,
    "references/source-policy.md",
    "# Source policy\n\nPrefer primary sources, official documentation, direct company posts, and clearly dated analyst notes. Reject claims that only cite vague social chatter.\n",
  );
  await writeSkillTextFile(
    skillNode,
    "examples/review-comment.md",
    "This draft is directionally useful, but the claim about enterprise adoption needs a dated source before approval.\n",
  );

  await seedNodeChangeRequestIfMissing({
    id: SEED_SKILL_CHANGE_REQUEST_ID,
    nodeId: skillNode.id,
    status: "in_review",
    submittedBy: "skill-maintainer-agent",
    sourceMeta: {
      seed: true,
      scenario: "skill-file-update",
      workflow: "skill-governance",
      subject: "skill",
      nodeId: skillNode.id,
    },
    createdAt: minutesBefore(createdAt, 6),
    operation: {
      id: SEED_SKILL_OPERATION_ID,
      commitId: SEED_SKILL_COMMIT_ID,
      operation: "skill_file_update",
      filePath: "SKILL.md",
      fields: {
        filePath: "SKILL.md",
        baseContentHash: hashText(skillMd),
        nextContent: `${skillMd}\n## Merge guardrails\n\n- Do not approve drafts that lack source receipts for market-size, policy, or benchmark claims.\n- Prefer a short reviewer note over rewriting the entire article.\n`,
      },
      message: "Add merge guardrails to AI Research Editor Skill",
      author: "skill-maintainer-agent",
    },
  });
};

export const ensureReady = async () => {
  const spaceId = getContextSpaceId();
  globalForStore.__busabaseReadyBySpace ??= new Map<string, Promise<void>>();
  const readyBySpace = globalForStore.__busabaseReadyBySpace;
  const cached = readyBySpace.get(spaceId);
  if (cached) {
    return cached;
  }

  const ready = (async () => {
    ensureDefaultStorageUrl();
    const db = await getDb();
    const createdAt = now();

    // Every space (local or cloud) gets its own root folder to attach nodes to.
    const rootNodeId = rootNodeIdForSpace(spaceId);
    const [existingRoot] = await db
      .select()
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, rootNodeId))
      .limit(1);
    if (!existingRoot) {
      await db.insert(busabaseNodes).values({
        id: rootNodeId,
        parentId: null,
        type: "folder",
        slug: "root",
        name: "Workspace",
        description: "Workspace root.",
        position: 0,
        createdAt,
        updatedAt: createdAt,
      });
    }

    // The demo workspace (content folder + seeded Bases / Skill / change
    // requests) only ever seeds the single-tenant open-source app — never a
    // real cloud space.
    if (spaceId !== LOCAL_SPACE_ID) {
      return;
    }

    const existingNodes = await db.select().from(busabaseNodes);
    const existingNodeById = new Map(existingNodes.map((node) => [node.id, node]));
    if (!existingNodeById.has(ROOT_NODE_ID)) {
      await db.insert(busabaseNodes).values({
        id: ROOT_NODE_ID,
        parentId: null,
        type: "folder",
        slug: "root",
        name: "Local workspace",
        description: "The root of this self-hosted Busabase workspace.",
        position: 0,
        createdAt,
        updatedAt: createdAt,
      });
    }

    await seedSkillNodeIfMissing(createdAt);
    await ensureProjectionBackfill();
  })();

  readyBySpace.set(spaceId, ready);
  return ready;
};

const applySeedScenario = async (scenario: SeedScenario) => {
  const db = await getDb();
  const createdAt = now();

  const existingNodes = await db.select().from(busabaseNodes);
  const existingNodeById = new Map(existingNodes.map((node) => [node.id, node]));
  // Also index by (parentId, slug) to handle ID renames across seed versions
  const existingNodeByParentSlug = new Map(
    existingNodes.map((node) => [`${node.parentId}:${node.slug}`, node]),
  );

  for (const folder of scenario.folders ?? []) {
    const alreadyExists =
      existingNodeById.has(folder.nodeId) ||
      existingNodeByParentSlug.has(`${ROOT_NODE_ID}:${folder.slug}`);
    if (!alreadyExists) {
      await db.insert(busabaseNodes).values({
        id: folder.nodeId,
        parentId: ROOT_NODE_ID,
        type: "folder",
        slug: folder.slug,
        name: folder.name,
        description: folder.description,
        position: folder.position,
        createdAt,
        updatedAt: createdAt,
      });
    }
  }

  const existingBases = await db.select().from(busabaseBases);
  const existingBaseBySlug = new Map(existingBases.map((base) => [base.slug, base]));

  for (const [baseIndex, base] of (scenario.bases ?? []).entries()) {
    // Resolve the actual folder node ID from the DB (handles ID renames)
    const folderNode =
      existingNodeById.get(base.folderNodeId) ??
      existingNodeByParentSlug.get(
        `${ROOT_NODE_ID}:${scenario.folders?.find((f) => f.nodeId === base.folderNodeId)?.slug ?? ""}`,
      );
    const actualFolderNodeId = folderNode?.id ?? base.folderNodeId;

    const baseNodeExists =
      existingNodeById.has(base.nodeId) ||
      existingNodeByParentSlug.has(`${actualFolderNodeId}:${base.slug}`);
    if (!baseNodeExists) {
      await db.insert(busabaseNodes).values({
        id: base.nodeId,
        parentId: actualFolderNodeId,
        type: "base",
        slug: base.slug,
        name: base.name,
        description: base.description,
        position: baseIndex,
        createdAt,
        updatedAt: createdAt,
      });
    }

    if (!existingBaseBySlug.has(base.slug)) {
      await db.insert(busabaseBases).values({
        id: base.id,
        nodeId: base.nodeId,
        slug: base.slug,
        name: base.name,
        description: base.description,
        reviewPolicy: { kind: "single", requiredApprovals: 1 },
        createdAt,
      });

      await db.insert(busabaseBaseFields).values(
        base.fields.map((field, index) => ({
          id: field.id,
          baseId: base.id,
          slug: field.slug,
          name: field.name,
          type: field.type,
          required: field.required,
          position: index,
          options: "options" in field ? field.options : {},
        })),
      );
    } else {
      // biome-ignore lint/style/noNonNullAssertion: guarded by existingBaseBySlug.has(base.slug) in the if-branch above
      const existingBase = existingBaseBySlug.get(base.slug)!;
      for (const [index, field] of base.fields.entries()) {
        const [existingField] = await db
          .select()
          .from(busabaseBaseFields)
          .where(
            and(
              eq(busabaseBaseFields.baseId, existingBase.id),
              eq(busabaseBaseFields.slug, field.slug),
            ),
          )
          .limit(1);
        const fieldValues = {
          name: field.name,
          type: field.type,
          required: field.required,
          position: index,
          options: "options" in field ? field.options : {},
        };
        if (existingField) {
          await db
            .update(busabaseBaseFields)
            .set(fieldValues)
            .where(
              and(
                eq(busabaseBaseFields.baseId, existingBase.id),
                eq(busabaseBaseFields.slug, field.slug),
              ),
            );
        } else {
          await db.insert(busabaseBaseFields).values({
            id: field.id,
            baseId: existingBase.id,
            slug: field.slug,
            ...fieldValues,
          });
        }
      }
    }
  }

  for (const record of scenario.records ?? []) {
    const recordCreatedAt = minutesBefore(createdAt, record.minutesAgo);
    await seedRecordIfMissing({
      id: record.id,
      baseId: record.baseId,
      commitId: record.commitId,
      fields: buildRecordSeedFields(record, recordCreatedAt.toISOString()),
      message: record.message,
      author: record.author,
      createdBy: CURRENT_USER_ID,
      createdAt: recordCreatedAt,
    });
  }

  for (const view of scenario.views ?? []) {
    await seedViewIfMissing({
      id: view.id,
      baseId: view.baseId,
      slug: view.slug,
      name: view.name,
      description: view.description,
      config: view.config,
      createdAt: minutesBefore(createdAt, view.minutesAgo),
    });
  }

  for (const changeRequest of scenario.changeRequests ?? []) {
    const changeRequestCreatedAt = minutesBefore(createdAt, changeRequest.minutesAgo);
    await seedChangeRequestIfMissing({
      id: changeRequest.id,
      baseId: changeRequest.baseId,
      status: changeRequest.status,
      submittedBy: changeRequest.submittedBy,
      sourceMeta: changeRequest.sourceMeta,
      createdAt: changeRequestCreatedAt,
      reviewedAt:
        changeRequest.reviewedMinutesAgo != null
          ? minutesBefore(createdAt, changeRequest.reviewedMinutesAgo)
          : null,
      operations: changeRequest.operations.map((operation) => ({
        id: operation.id,
        commitId: operation.commitId,
        operation: operation.operation,
        fields: operation.fields,
        message: operation.message,
        author: operation.author,
        targetRecordId: operation.targetRecordId,
        targetViewId: operation.targetViewId,
        sourceRecordId: operation.sourceRecordId,
        sourceCommitId: operation.sourceCommitId,
        baseCommitId: operation.baseCommitId,
        deleteMode: operation.deleteMode,
      })),
    });
  }

  await ensureProjectionBackfill();
};

export const seedScenario = async (scenario: SeedScenario) => {
  await ensureReady();
  await applySeedScenario(scenario);
};

export const loadBasesByIds = async (baseIds: string[]) => {
  const db = await getDb();
  if (baseIds.length === 0) {
    return new Map<string, BaseVO>();
  }

  const baseRows = await db.select().from(busabaseBases).where(inArray(busabaseBases.id, baseIds));
  const fieldRows = await db
    .select()
    .from(busabaseBaseFields)
    .where(inArray(busabaseBaseFields.baseId, baseIds));
  return new Map(
    baseRows.map((base) => [
      base.id,
      toBaseVO(
        base,
        fieldRows.filter((field) => field.baseId === base.id),
      ),
    ]),
  );
};

const flattenNodeTree = (nodes: NodeVO[]): NodeVO[] =>
  nodes.flatMap((node) => [node, ...flattenNodeTree(node.children)]);

export const loadNodesByIds = async (nodeIds: string[]) => {
  if (nodeIds.length === 0) {
    return new Map<string, NodeVO>();
  }
  const tree = await listNodes();
  return new Map(
    flattenNodeTree(tree)
      .filter((node) => nodeIds.includes(node.id))
      .map((node) => [node.id, node]),
  );
};

export const hydrateChangeRequest = async (
  changeRequest: ChangeRequestPO,
): Promise<ChangeRequestVO> => {
  const db = await getDb();
  const baseMap = await loadBasesByIds(changeRequest.baseId ? [changeRequest.baseId] : []);
  const nodeMap = await loadNodesByIds(changeRequest.nodeId ? [changeRequest.nodeId] : []);
  const itemRows = await db
    .select()
    .from(busabaseOperations)
    .where(eq(busabaseOperations.changeRequestId, changeRequest.id))
    .orderBy(asc(busabaseOperations.position), asc(busabaseOperations.createdAt));
  const operationHeadCommitIds = itemRows.map((item) => item.headCommitId);
  const commitRows =
    operationHeadCommitIds.length > 0
      ? await db
          .select()
          .from(busabaseCommits)
          .where(inArray(busabaseCommits.id, operationHeadCommitIds))
      : [];
  const commitsById = new Map(commitRows.map((commit) => [commit.id, commit]));

  // Resolve each operation's canonical "before" values so the UI can diff:
  // records read from the base commit; views read from the current view row.
  const baseCommitIds = itemRows
    .map((item) => item.baseCommitId)
    .filter((id): id is string => Boolean(id));
  const baseCommitRows =
    baseCommitIds.length > 0
      ? await db.select().from(busabaseCommits).where(inArray(busabaseCommits.id, baseCommitIds))
      : [];
  const baseCommitsById = new Map(baseCommitRows.map((commit) => [commit.id, commit]));
  const viewTargetIds = itemRows
    .filter(
      (item) =>
        (item.operation === "view_update" || item.operation === "view_delete") && item.targetViewId,
    )
    .map((item) => item.targetViewId as string);
  const viewRows =
    viewTargetIds.length > 0
      ? await db.select().from(busabaseViews).where(inArray(busabaseViews.id, viewTargetIds))
      : [];
  const viewsById = new Map(viewRows.map((view) => [view.id, view]));

  const resolveBaseFields = (item: OperationPO): Record<string, unknown> | null => {
    if (item.operation === "record_update" || item.operation === "record_delete") {
      const baseCommit = item.baseCommitId ? baseCommitsById.get(item.baseCommitId) : undefined;
      return baseCommit ? baseCommit.fields : null;
    }
    if (item.operation === "view_update" || item.operation === "view_delete") {
      const view = item.targetViewId ? viewsById.get(item.targetViewId) : undefined;
      return view
        ? {
            name: view.name,
            description: view.description,
            config: normalizeViewConfig(view.config),
          }
        : null;
    }
    return null;
  };

  const operations = itemRows.map((item) => {
    const commit = commitsById.get(item.headCommitId);
    if (!commit) {
      throw new Error(`Invalid operation graph for ${item.id}`);
    }
    return toOperationVO(item, commit, resolveBaseFields(item));
  });
  const reviewRows = await db
    .select()
    .from(busabaseReviews)
    .where(eq(busabaseReviews.changeRequestId, changeRequest.id))
    .orderBy(desc(busabaseReviews.createdAt));
  const base = changeRequest.baseId ? (baseMap.get(changeRequest.baseId) ?? null) : null;
  const node = changeRequest.nodeId ? (nodeMap.get(changeRequest.nodeId) ?? null) : null;
  if (changeRequest.targetType === "base" && !base) {
    throw new Error(`Invalid changeRequest graph for ${changeRequest.id}`);
  }
  if (changeRequest.targetType === "node" && changeRequest.nodeId && !node) {
    throw new Error(`Invalid node changeRequest graph for ${changeRequest.id}`);
  }

  return {
    id: changeRequest.id,
    baseId: changeRequest.baseId,
    targetType: changeRequest.targetType,
    nodeId: changeRequest.nodeId,
    status: changeRequest.status,
    submittedBy: changeRequest.submittedBy,
    sourceMeta: changeRequest.sourceMeta,
    reviewPolicySnapshot: changeRequest.reviewPolicySnapshot,
    mergeSummary: changeRequest.mergeSummary,
    rejectedReason: changeRequest.rejectedReason,
    reviewedAt: toIso(changeRequest.reviewedAt),
    mergedAt: toIso(changeRequest.mergedAt),
    createdAt: changeRequest.createdAt.toISOString(),
    updatedAt: changeRequest.updatedAt.toISOString(),
    base,
    node,
    operations,
    primaryOperation: operations[0] ?? null,
    operationCount: operations.length,
    reviews: reviewRows.map(toReviewVO),
  };
};

export const hydrateRecord = async (record: RecordPO): Promise<RecordVO> => {
  const db = await getDb();
  const baseMap = await loadBasesByIds([record.baseId]);
  const [headCommit] = await db
    .select()
    .from(busabaseCommits)
    .where(eq(busabaseCommits.id, record.headCommitId))
    .limit(1);
  const base = baseMap.get(record.baseId);
  if (!base || !headCommit) {
    throw new Error(`Invalid record graph for ${record.id}`);
  }

  return {
    id: record.id,
    baseId: record.baseId,
    headCommitId: record.headCommitId,
    parentRecordId: record.parentRecordId,
    parentCommitId: record.parentCommitId,
    status: record.status === "archived" ? "archived" : "active",
    createdBy: record.createdBy,
    archivedAt: toIso(record.archivedAt),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    base,
    headCommit: toCommitVO(headCommit),
  };
};

export const listNodes = async () => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const [nodeRows, baseRows] = await Promise.all([
    db
      .select()
      .from(busabaseNodes)
      .where(eq(busabaseNodes.spaceId, spaceId))
      .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt)),
    db.select().from(busabaseBases).where(eq(busabaseBases.spaceId, spaceId)),
  ]);
  return buildNodeTree(nodeRows, baseRows);
};

export const createNodeChangeRequest = async (
  input: z.input<typeof createNodeChangeRequestInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const parsed = createNodeChangeRequestInputSchema.parse(input);
  const submittedBy = resolveActorId(parsed.submittedBy);
  const changeRequestId = id("crq");
  const timestamp = now();

  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: null,
    targetType: "node",
    nodeId: null,
    status: "in_review",
    submittedBy,
    sourceMeta: { subject: "node_tree" },
    reviewPolicySnapshot: { kind: "single", requiredApprovals: 1 },
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  for (const [position, operation] of parsed.operations.entries()) {
    const operationId = id("opr");
    const commitId = id("cmt");
    const operationKind =
      operation.kind === "create"
        ? "node_create"
        : operation.kind === "rename"
          ? "node_rename"
          : operation.kind === "delete"
            ? "node_delete"
            : "node_move";
    const nodeId = operation.kind === "create" ? null : operation.nodeId;

    await db.insert(busabaseCommits).values({
      id: commitId,
      baseId: null,
      targetType: "node",
      nodeId,
      operationId: null,
      parentCommitId: null,
      fields: operation,
      operation: operationKind,
      message: parsed.message,
      author: submittedBy,
      createdAt: timestamp,
    });
    await db.insert(busabaseOperations).values({
      id: operationId,
      changeRequestId,
      baseId: null,
      targetType: "node",
      nodeId,
      operation: operationKind,
      status: "pending",
      targetRecordId: null,
      targetViewId: null,
      filePath: null,
      sourceRecordId: null,
      sourceCommitId: null,
      baseCommitId: null,
      headCommitId: commitId,
      deleteMode: "archive",
      mergedRecordId: null,
      mergedViewId: null,
      position,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));
  }

  await insertAuditEvent(db, {
    action: "change_request.created",
    actorId: parsed.submittedBy,
    baseId: null,
    changeRequestId,
    metadata: { operation: "node_tree_update" },
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create node change request");
  }
  return changeRequest;
};

export const listChangeRequests = async (input?: z.input<typeof listInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = listInputSchema.parse(input);
  const changeRequestRows = await db
    .select()
    .from(busabaseChangeRequests)
    .where(eq(busabaseChangeRequests.spaceId, getContextSpaceId()))
    .orderBy(desc(busabaseChangeRequests.createdAt))
    .limit(parsed.limit);
  return Promise.all(changeRequestRows.map(hydrateChangeRequest));
};

export const getChangeRequest = async (changeRequestId: string) => {
  await ensureReady();
  const db = await getDb();
  const [changeRequest] = await db
    .select()
    .from(busabaseChangeRequests)
    .where(
      and(
        eq(busabaseChangeRequests.id, changeRequestId),
        eq(busabaseChangeRequests.spaceId, getContextSpaceId()),
      ),
    )
    .limit(1);
  return changeRequest ? hydrateChangeRequest(changeRequest) : null;
};

export const listRecordChangeRequests = async (recordId: string) => {
  await ensureReady();
  const db = await getDb();
  const operationRows = await db
    .select({
      changeRequestId: busabaseOperations.changeRequestId,
      updatedAt: busabaseOperations.updatedAt,
    })
    .from(busabaseOperations)
    .where(
      or(
        eq(busabaseOperations.mergedRecordId, recordId),
        eq(busabaseOperations.targetRecordId, recordId),
        eq(busabaseOperations.sourceRecordId, recordId),
      ),
    )
    .orderBy(desc(busabaseOperations.updatedAt));
  const changeRequestIds = [
    ...new Set(operationRows.map((operation) => operation.changeRequestId)),
  ];
  if (changeRequestIds.length === 0) {
    return [];
  }

  const changeRequestRows = await db
    .select()
    .from(busabaseChangeRequests)
    .where(inArray(busabaseChangeRequests.id, changeRequestIds));
  const changeRequestsById = new Map(
    changeRequestRows.map((changeRequest) => [changeRequest.id, changeRequest]),
  );
  return Promise.all(
    changeRequestIds
      .map((changeRequestId) => changeRequestsById.get(changeRequestId))
      .filter((changeRequest): changeRequest is ChangeRequestPO => Boolean(changeRequest))
      .map(hydrateChangeRequest),
  );
};

export const createAuditEvent = async (input: z.infer<typeof auditEventInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  return insertAuditEvent(db, input);
};

export const listAuditEvents = async (input?: z.input<typeof listInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = listInputSchema.parse(input);
  const events = await db
    .select()
    .from(busabaseAuditEvents)
    .where(eq(busabaseAuditEvents.spaceId, getContextSpaceId()))
    .orderBy(desc(busabaseAuditEvents.createdAt))
    .limit(parsed.limit);
  return events.map(toAuditEventVO);
};

export const listComments = async (input: z.infer<typeof commentSubjectInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = commentSubjectInputSchema.parse(input);
  const comments = await db
    .select()
    .from(busabaseComments)
    .where(
      and(
        eq(busabaseComments.spaceId, getContextSpaceId()),
        eq(busabaseComments.subjectType, parsed.subjectType),
        eq(busabaseComments.subjectId, parsed.subjectId),
      ),
    )
    .orderBy(asc(busabaseComments.createdAt));
  return comments.map(toCommentVO);
};

export const createComment = async (input: z.infer<typeof createCommentInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = createCommentInputSchema.parse(input);
  const subjectLinks = await resolveCommentSubject(db, parsed.subjectType, parsed.subjectId);
  const timestamp = now();
  const [comment] = await db
    .insert(busabaseComments)
    .values({
      id: id("com"),
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
      recordId: subjectLinks.recordId,
      changeRequestId: subjectLinks.changeRequestId,
      operationId: subjectLinks.operationId,
      commitId: subjectLinks.commitId,
      authorId: resolveActorId(parsed.authorId),
      body: parsed.body,
      mentionsAi: parsed.mentionsAi,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  if (parsed.mentionsAi && subjectLinks.changeRequestId) {
    notifyAgentOfChangeRequest(subjectLinks.changeRequestId, "ai_mention");
  }
  return toCommentVO(comment);
};

export const reviseOperation = async (
  operationId: string,
  input: z.infer<typeof reviseOperationInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const parsed = reviseOperationInputSchema.parse(input);
  const [operation] = await db
    .select()
    .from(busabaseOperations)
    .where(eq(busabaseOperations.id, operationId))
    .limit(1);
  if (!operation) {
    throw new Error(`Operation not found: ${operationId}`);
  }

  const [changeRequest] = await db
    .select()
    .from(busabaseChangeRequests)
    .where(eq(busabaseChangeRequests.id, operation.changeRequestId))
    .limit(1);
  if (!changeRequest) {
    throw new Error(`ChangeRequest not found: ${operation.changeRequestId}`);
  }
  if (changeRequest.status !== "in_review" && changeRequest.status !== "changes_requested") {
    throw new Error(
      `Operation is not revisable after changeRequest status: ${changeRequest.status}`,
    );
  }

  const commitId = id("cmt");
  const timestamp = now();
  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: operation.baseId,
    targetType: operation.targetType,
    nodeId: operation.nodeId,
    operationId: operation.id,
    parentCommitId: operation.headCommitId,
    fields: parsed.fields,
    operation: operation.operation,
    message: parsed.message,
    author: parsed.author,
    createdAt: timestamp,
  });

  await db
    .update(busabaseOperations)
    .set({ headCommitId: commitId, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, operation.id));
  // Revising in response to a review returns the CR to the reviewer's queue.
  await db
    .update(busabaseChangeRequests)
    .set({ status: "in_review", updatedAt: timestamp })
    .where(eq(busabaseChangeRequests.id, operation.changeRequestId));

  await projectCommitFields({
    baseId: requireBaseId(operation.baseId, "reviseOperation"),
    commitId,
    changeRequestId: operation.changeRequestId,
    operationId: operation.id,
    fields: parsed.fields,
  });
  await insertAuditEvent(db, {
    action: "change_request.updated",
    actorId: parsed.author,
    baseId: operation.baseId,
    changeRequestId: operation.changeRequestId,
    operationId: operation.id,
    commitId,
    metadata: { operation: operation.operation, revision: true },
  });

  const updatedChangeRequest = await getChangeRequest(operation.changeRequestId);
  if (!updatedChangeRequest) {
    throw new Error("Failed to revise operation");
  }
  return updatedChangeRequest;
};

export const reviewChangeRequest = async (
  changeRequestId: string,
  input: z.infer<typeof reviewInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const parsed = reviewInputSchema.parse(input);
  const [changeRequest] = await db
    .select()
    .from(busabaseChangeRequests)
    .where(eq(busabaseChangeRequests.id, changeRequestId))
    .limit(1);
  if (!changeRequest) {
    throw new Error(`ChangeRequest not found: ${changeRequestId}`);
  }
  if (changeRequest.status !== "in_review" && changeRequest.status !== "changes_requested") {
    throw new Error(`ChangeRequest is not reviewable: ${changeRequest.status}`);
  }

  const operationKinds = await db
    .select()
    .from(busabaseOperations)
    .where(eq(busabaseOperations.changeRequestId, changeRequest.id));
  if (operationKinds.length === 0) {
    throw new Error(`ChangeRequest has no operations: ${changeRequest.id}`);
  }
  const visibleOperationHeads = Object.fromEntries(
    operationKinds.map((item) => [item.id, item.headCommitId]),
  );
  const timestamp = now();
  // One vote per reviewer per change request: re-reviewing (e.g. request changes,
  // then approve after the agent revises) replaces this reviewer's latest verdict
  // and re-snapshots the operation heads they saw.
  await db
    .insert(busabaseReviews)
    .values({
      id: id("rev"),
      changeRequestId: changeRequest.id,
      reviewerId: resolveActorId(CURRENT_USER_ID),
      verdict: parsed.verdict,
      reason: parsed.reason ?? null,
      visibleOperationHeads,
      createdAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [busabaseReviews.changeRequestId, busabaseReviews.reviewerId],
      set: {
        verdict: parsed.verdict,
        reason: parsed.reason ?? null,
        visibleOperationHeads,
        createdAt: timestamp,
      },
    });

  // "rejected" verdict = "request changes": a soft, non-terminal state the agent
  // can revise out of (see reviseOperation). Explicit termination is closeChangeRequest.
  await db
    .update(busabaseChangeRequests)
    .set({
      status: parsed.verdict === "approved" ? "approved" : "changes_requested",
      rejectedReason: null,
      reviewedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(busabaseChangeRequests.id, changeRequest.id));
  await insertAuditEvent(db, {
    action: "change_request.reviewed",
    actorId: CURRENT_USER_ID,
    baseId: changeRequest.baseId,
    changeRequestId: changeRequest.id,
    metadata: { verdict: parsed.verdict },
  });
  if (parsed.verdict !== "approved") {
    notifyAgentOfChangeRequest(changeRequest.id, "changes_requested");
  }

  const updated = await getChangeRequest(changeRequest.id);
  if (!updated) {
    throw new Error("Failed to review changeRequest");
  }
  return updated;
};

// Terminal close: drop a change request for good (distinct from "request changes",
// which stays revisable). Only valid from non-terminal states.
export const closeChangeRequest = async (changeRequestId: string, reason?: string) => {
  await ensureReady();
  const db = await getDb();
  const [changeRequest] = await db
    .select()
    .from(busabaseChangeRequests)
    .where(eq(busabaseChangeRequests.id, changeRequestId))
    .limit(1);
  if (!changeRequest) {
    throw new Error(`ChangeRequest not found: ${changeRequestId}`);
  }
  if (!["in_review", "changes_requested", "approved"].includes(changeRequest.status)) {
    throw new Error(`ChangeRequest is not closable: ${changeRequest.status}`);
  }
  const timestamp = now();
  await db
    .update(busabaseChangeRequests)
    .set({
      status: "rejected",
      rejectedReason: reason ?? "Closed by reviewer",
      reviewedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(busabaseChangeRequests.id, changeRequest.id));
  await insertAuditEvent(db, {
    action: "change_request.reviewed",
    actorId: CURRENT_USER_ID,
    baseId: changeRequest.baseId,
    changeRequestId: changeRequest.id,
    metadata: { verdict: "closed" },
  });

  const updated = await getChangeRequest(changeRequest.id);
  if (!updated) {
    throw new Error("Failed to close changeRequest");
  }
  return updated;
};

// ── Agent trigger ───────────────────────────────────────────────────────────
// External agents (incl. via ACP) are never embedded. They either POLL
// `listAgentTasks` or receive a best-effort PUSH. The push is the seam: set
// BUSABASE_AGENT_WEBHOOK_URL to enable it; it never blocks or fails the request,
// and poll-based agents simply ignore it. Webhook/ACP transports plug in here.
export type AgentTaskTrigger = "changes_requested" | "ai_mention";

const notifyAgentOfChangeRequest = (changeRequestId: string, trigger: AgentTaskTrigger) => {
  const url = process.env.BUSABASE_AGENT_WEBHOOK_URL;
  if (!url) {
    return;
  }
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "agent.task", trigger, changeRequestId }),
  }).catch(() => {
    // Best-effort: a down agent webhook must never break the review action.
  });
};

// Work queue for an external agent: change requests awaiting revision. A CR is
// queued when a reviewer requested changes, or when it carries an unaddressed
// `@ai` mention (CR- or operation-scoped). Each task is self-describing so the
// agent can revise via the REST API (reviseOperation → CR returns to in_review).
export const listAgentTasks = async () => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const openChangeRequests = await db
    .select()
    .from(busabaseChangeRequests)
    .where(
      and(
        eq(busabaseChangeRequests.spaceId, spaceId),
        inArray(busabaseChangeRequests.status, ["in_review", "changes_requested"]),
      ),
    )
    .orderBy(asc(busabaseChangeRequests.createdAt));
  if (openChangeRequests.length === 0) {
    return [];
  }

  const changeRequestIds = openChangeRequests.map((changeRequest) => changeRequest.id);
  const aiCommentRows = await db
    .select()
    .from(busabaseComments)
    .where(
      and(
        eq(busabaseComments.spaceId, spaceId),
        eq(busabaseComments.mentionsAi, true),
        inArray(busabaseComments.changeRequestId, changeRequestIds),
      ),
    )
    .orderBy(asc(busabaseComments.createdAt));
  const aiCommentsByChangeRequest = new Map<string, CommentPO[]>();
  for (const comment of aiCommentRows) {
    if (!comment.changeRequestId) {
      continue;
    }
    const list = aiCommentsByChangeRequest.get(comment.changeRequestId) ?? [];
    list.push(comment);
    aiCommentsByChangeRequest.set(comment.changeRequestId, list);
  }

  const queued = openChangeRequests.filter(
    (changeRequest) =>
      changeRequest.status === "changes_requested" ||
      aiCommentsByChangeRequest.has(changeRequest.id),
  );

  return Promise.all(
    queued.map(async (changeRequestRow) => {
      const changeRequest = await hydrateChangeRequest(changeRequestRow);
      const latestReview =
        changeRequest.reviews.length > 0
          ? changeRequest.reviews.reduce((latest, review) =>
              review.createdAt > latest.createdAt ? review : latest,
            )
          : null;
      return {
        changeRequest,
        trigger: (changeRequestRow.status === "changes_requested"
          ? "changes_requested"
          : "ai_mention") as AgentTaskTrigger,
        reviewReason: latestReview?.reason ?? null,
        aiComments: (aiCommentsByChangeRequest.get(changeRequestRow.id) ?? []).map(toCommentVO),
      };
    }),
  );
};

// ============================================================================
// Merge engine — dispatcher + per-operation-kind handlers.
//
// `mergeChangeRequest` is the kernel's change-request lifecycle terminus; it has
// become a DISPATCHER that, for each operation, calls the handler owned by the
// operation's domain. Handlers share a `MergeCtx` (db/tx + the pre-loaded commit,
// record, and view lookups + the merged-id accumulators). Handlers are grouped by
// owning domain below so they can later move into domains/<type>/handlers.ts with
// no behavioural change; the kernel keeps only the lifecycle + this dispatch.
// ============================================================================

export interface MergeCtx {
  db: Awaited<ReturnType<typeof getDb>>;
  timestamp: Date;
  /** Actor merging the change request — recorded for created_by / updated_by fields. */
  actorId: string;
  headCommitsById: Map<string, CommitPO>;
  targetRecordsById: Map<string, RecordPO>;
  targetViewsById: Map<string, ViewPO>;
  mergedNodeIds: string[];
  mergedRecordIds: string[];
  mergedViewIds: string[];
  // Auto-merged record fields (operationId → merged fields), set when a record
  // moved since the change request's base and a 3-way field merge resolved it.
  resolvedRecordFields: Map<string, Record<string, unknown>>;
}

// Git-style 3-way field merge: `theirs` (the change request, possibly partial) is
// overlaid onto `ours` (current canonical) relative to their common ancestor
// `base`. A field only the CR changed is taken; a field only canonical changed is
// kept; the same field changed differently on both sides is a conflict.
interface ThreeWayMergeResult {
  merged: Record<string, unknown>;
  conflicts: string[];
}

const stableFieldStringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableFieldStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableFieldStringify(record[key])}`)
    .join(",")}}`;
};

const fieldValuesEqual = (left: unknown, right: unknown) =>
  stableFieldStringify(left) === stableFieldStringify(right);

const threeWayMergeFields = (
  base: Record<string, unknown>,
  ours: Record<string, unknown>,
  theirs: Record<string, unknown>,
): ThreeWayMergeResult => {
  const merged: Record<string, unknown> = { ...ours };
  const conflicts: string[] = [];
  for (const key of Object.keys(theirs)) {
    if (fieldValuesEqual(theirs[key], base[key])) {
      continue; // the change request did not touch this field
    }
    const oursChanged = !fieldValuesEqual(ours[key], base[key]);
    if (!oursChanged || fieldValuesEqual(ours[key], theirs[key])) {
      merged[key] = theirs[key]; // only the CR changed it (or both agree)
      continue;
    }
    conflicts.push(key); // both sides changed this field differently
  }
  return { merged, conflicts };
};

// --- folder / kernel: generic node operations -------------------------------
// `node_create` dispatches to the type's materialization. folder is the minimal
// case (just the node row); skill seeds its storage files; base also materializes
// a Base row + fields. (Spec: container/has-detail are capabilities, not folder
// checks; this inline base branch will move to base.materialize.)
const materializeGenericNode = async (ctx: MergeCtx, args: MaterializeArgs): Promise<string> => {
  const { db, timestamp } = ctx;
  const { parentNode, fields } = args;
  const nodeId = id("nod");
  await db.insert(busabaseNodes).values({
    id: nodeId,
    parentId: parentNode.id,
    type: fields.nodeType as BusabaseNodeType,
    slug: fields.slug as string,
    name: fields.name as string,
    description: fields.description ?? "",
    metadata: fields.metadata || {},
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return nodeId;
};

const mergeNodeCreate = async (ctx: MergeCtx, item: OperationPO, headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const fields = headCommit.fields as NodeCreateFields;
  const parentNodeId = fields.parentNodeId ?? rootNodeIdForSpace(getContextSpaceId());
  const [parentNode] = await db
    .select()
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, parentNodeId))
    .limit(1);
  if (!parentNode || parentNode.type !== "folder") {
    throw new Error(`Parent folder not found: ${parentNodeId}`);
  }
  if (!fields.nodeType || !fields.slug || !fields.name) {
    throw new Error(`Node create commit missing required fields: ${item.id}`);
  }
  // node_create dispatches to the type-owned materializer; types with none
  // registered (folder/file/agent) get the generic node row.
  const materialize = getMaterializer(fields.nodeType) ?? materializeGenericNode;
  const nodeId = await materialize(ctx, { parentNode, fields });
  await db
    .update(busabaseOperations)
    .set({ status: "merged", nodeId, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedNodeIds.push(nodeId);
};

const mergeNodeRename = async (
  ctx: MergeCtx,
  _item: OperationPO,
  node: NodePO,
  headCommit: CommitPO,
) => {
  const fields = headCommit.fields as {
    slug?: string;
    name?: string;
    description?: string;
  };
  await ctx.db
    .update(busabaseNodes)
    .set({
      slug: fields.slug ?? node.slug,
      name: fields.name ?? node.name,
      description: fields.description ?? node.description,
      updatedAt: ctx.timestamp,
    })
    .where(eq(busabaseNodes.id, node.id));
  if (node.type === "base") {
    await ctx.db
      .update(busabaseBases)
      .set({
        slug: fields.slug ?? node.slug,
        name: fields.name ?? node.name,
        description: fields.description ?? node.description,
      })
      .where(eq(busabaseBases.nodeId, node.id));
  }
};

const mergeNodeMove = async (
  ctx: MergeCtx,
  item: OperationPO,
  node: NodePO,
  headCommit: CommitPO,
) => {
  const fields = headCommit.fields as { parentNodeId?: string; position?: number };
  if (!fields.parentNodeId) {
    throw new Error(`Node move commit missing parentNodeId: ${item.id}`);
  }
  const [parentNode] = await ctx.db
    .select()
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, fields.parentNodeId))
    .limit(1);
  if (!parentNode || parentNode.type !== "folder") {
    throw new Error(`Parent folder not found: ${fields.parentNodeId}`);
  }
  await ctx.db
    .update(busabaseNodes)
    .set({
      parentId: parentNode.id,
      position: fields.position ?? node.position,
      updatedAt: ctx.timestamp,
    })
    .where(eq(busabaseNodes.id, node.id));
};

const mergeNodeDelete = async (ctx: MergeCtx, _item: OperationPO, node: NodePO) => {
  await ctx.db.delete(busabaseNodes).where(eq(busabaseNodes.id, node.id));
};

export const mergeChangeRequest = async (changeRequestId: string) => {
  await ensureReady();
  const db = await getDb();
  const [changeRequest] = await db
    .select()
    .from(busabaseChangeRequests)
    .where(
      and(
        eq(busabaseChangeRequests.id, changeRequestId),
        eq(busabaseChangeRequests.spaceId, getContextSpaceId()),
      ),
    )
    .limit(1);
  if (!changeRequest) {
    throw new Error(`ChangeRequest not found: ${changeRequestId}`);
  }
  if (changeRequest.status !== "approved") {
    throw new Error("ChangeRequest must be approved before merge");
  }

  const timestamp = now();
  const operationKinds = await db
    .select()
    .from(busabaseOperations)
    .where(eq(busabaseOperations.changeRequestId, changeRequest.id))
    .orderBy(asc(busabaseOperations.position), asc(busabaseOperations.createdAt));
  if (operationKinds.length === 0) {
    throw new Error(`ChangeRequest has no operations: ${changeRequest.id}`);
  }

  const operationHeadCommitIds = operationKinds.map((item) => item.headCommitId);
  const headCommitRows = await db
    .select()
    .from(busabaseCommits)
    .where(inArray(busabaseCommits.id, operationHeadCommitIds));
  const headCommitsById = new Map(headCommitRows.map((commit) => [commit.id, commit]));

  // --- node-targeted change requests (tree + skill payloads) ----------------
  if (changeRequest.targetType === "node") {
    const ctx: MergeCtx = {
      db,
      timestamp,
      actorId: changeRequest.submittedBy,
      headCommitsById,
      targetRecordsById: new Map(),
      targetViewsById: new Map(),
      mergedNodeIds: [],
      mergedRecordIds: [],
      mergedViewIds: [],
      resolvedRecordFields: new Map(),
    };
    for (const item of operationKinds) {
      const headCommit = headCommitsById.get(item.headCommitId);
      if (!headCommit) {
        throw new Error(`Operation head commit not found: ${item.headCommitId}`);
      }

      if (item.operation === "node_create") {
        await mergeNodeCreate(ctx, item, headCommit);
        continue;
      }

      if (!item.nodeId) {
        throw new Error(`${item.operation} operation has no nodeId: ${item.id}`);
      }
      const [node] = await db
        .select()
        .from(busabaseNodes)
        .where(eq(busabaseNodes.id, item.nodeId))
        .limit(1);
      if (!node) {
        throw new Error(`Node not found: ${item.nodeId}`);
      }

      if (item.operation === "node_rename") {
        await mergeNodeRename(ctx, item, node, headCommit);
      } else if (item.operation === "node_move") {
        await mergeNodeMove(ctx, item, node, headCommit);
      } else if (item.operation === "node_delete") {
        await mergeNodeDelete(ctx, item, node);
      } else if (
        item.operation === "skill_file_create" ||
        item.operation === "skill_file_update" ||
        item.operation === "skill_file_delete"
      ) {
        await mergeSkillFile(ctx, item, node, headCommit);
      } else if (item.operation === "skill_metadata_update") {
        await mergeSkillMetadata(ctx, item, node, headCommit);
      } else if (item.operation === "doc_update") {
        await mergeDocUpdate(ctx, item, node, headCommit);
      } else {
        throw new Error(`Unsupported node operation: ${item.operation}`);
      }

      await db
        .update(busabaseOperations)
        .set({ status: "merged", updatedAt: timestamp })
        .where(eq(busabaseOperations.id, item.id));
      ctx.mergedNodeIds.push(item.nodeId);
    }

    await db
      .update(busabaseChangeRequests)
      .set({
        status: "merged",
        mergeSummary: { mergedNodeIds: [...new Set(ctx.mergedNodeIds)] },
        mergedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(busabaseChangeRequests.id, changeRequest.id));
    await insertAuditEvent(db, {
      action: "change_request.merged",
      actorId: CURRENT_USER_ID,
      baseId: null,
      changeRequestId: changeRequest.id,
      metadata: { mergedNodeIds: [...new Set(ctx.mergedNodeIds)] },
    });
    const updated = await getChangeRequest(changeRequest.id);
    if (!updated) {
      throw new Error("Failed to load merged node changeRequest");
    }
    return { changeRequest: updated, record: null, view: null };
  }

  // --- base-targeted change requests (records + views) ----------------------
  const targetRecordIds = operationKinds
    .filter((item) => item.operation === "record_update" || item.operation === "record_delete")
    .map((item) => item.targetRecordId)
    .filter((targetRecordId): targetRecordId is string => Boolean(targetRecordId));
  const targetRecordRows =
    targetRecordIds.length > 0
      ? await db.select().from(busabaseRecords).where(inArray(busabaseRecords.id, targetRecordIds))
      : [];
  const targetRecordsById = new Map(targetRecordRows.map((record) => [record.id, record]));
  const targetViewIds = operationKinds
    .filter((item) => item.operation === "view_update" || item.operation === "view_delete")
    .map((item) => item.targetViewId)
    .filter((targetViewId): targetViewId is string => Boolean(targetViewId));
  const targetViewRows =
    targetViewIds.length > 0
      ? await db.select().from(busabaseViews).where(inArray(busabaseViews.id, targetViewIds))
      : [];
  const targetViewsById = new Map(targetViewRows.map((view) => [view.id, view]));
  const resolvedRecordFields = new Map<string, Record<string, unknown>>();

  for (const item of operationKinds) {
    if (!headCommitsById.has(item.headCommitId)) {
      throw new Error(`Operation head commit not found: ${item.headCommitId}`);
    }

    if (item.operation !== "record_update" && item.operation !== "record_delete") {
      if (item.operation !== "view_update" && item.operation !== "view_delete") {
        continue;
      }

      if (!item.targetViewId) {
        throw new Error(`${item.operation} item has no target view: ${item.id}`);
      }

      const targetView = targetViewsById.get(item.targetViewId);
      if (!targetView || targetView.status !== "active") {
        throw new Error(`Target view not found: ${item.targetViewId}`);
      }
      continue;
    }

    if (!item.targetRecordId) {
      throw new Error(`${item.operation} item has no target record: ${item.id}`);
    }

    const targetRecord = targetRecordsById.get(item.targetRecordId);
    if (!targetRecord) {
      throw new Error(`Target record not found: ${item.targetRecordId}`);
    }

    // The record moved since this change request's base. Instead of failing
    // outright, attempt a field-level 3-way merge; only a genuine same-field
    // conflict blocks the merge (record_delete is intent-preserving regardless).
    if (
      item.operation === "record_update" &&
      item.baseCommitId &&
      targetRecord.headCommitId !== item.baseCommitId
    ) {
      const proposed = headCommitsById.get(item.headCommitId);
      if (!proposed) {
        throw new Error(`Operation head commit not found: ${item.headCommitId}`);
      }
      const [baseCommit] = await db
        .select()
        .from(busabaseCommits)
        .where(eq(busabaseCommits.id, item.baseCommitId))
        .limit(1);
      const [oursCommit] = await db
        .select()
        .from(busabaseCommits)
        .where(eq(busabaseCommits.id, targetRecord.headCommitId))
        .limit(1);
      const { merged, conflicts } = threeWayMergeFields(
        baseCommit?.fields ?? {},
        oursCommit?.fields ?? {},
        proposed.fields,
      );
      if (conflicts.length > 0) {
        throw new ORPCError("CONFLICT", {
          message: `Cannot merge — the record changed since this change request. Conflicting field${
            conflicts.length === 1 ? "" : "s"
          }: ${conflicts.map((field) => `"${field}"`).join(", ")}. Revise the change request to resolve.`,
          data: { recordId: item.targetRecordId, conflicts },
        });
      }
      resolvedRecordFields.set(item.id, merged);
    }
  }

  const ctx: MergeCtx = {
    db,
    timestamp,
    actorId: changeRequest.submittedBy,
    headCommitsById,
    targetRecordsById,
    targetViewsById,
    mergedNodeIds: [],
    mergedRecordIds: [],
    mergedViewIds: [],
    resolvedRecordFields,
  };
  for (const item of operationKinds) {
    const headCommit = headCommitsById.get(item.headCommitId);
    if (!headCommit) {
      throw new Error(`Operation head commit not found: ${item.headCommitId}`);
    }

    switch (item.operation) {
      case "record_create":
      case "record_variant":
        await mergeRecordCreate(ctx, item, headCommit);
        break;
      case "view_create":
        await mergeViewCreate(ctx, item, headCommit);
        break;
      case "view_update":
        await mergeViewUpdate(ctx, item, headCommit);
        break;
      case "view_delete":
        await mergeViewDelete(ctx, item, headCommit);
        break;
      case "record_update":
        await mergeRecordUpdate(ctx, item, headCommit);
        break;
      case "record_delete":
        await mergeRecordDelete(ctx, item, headCommit);
        break;
      case "base_add_field":
        await mergeBaseAddField(ctx, item, headCommit);
        break;
      default:
        break;
    }
  }
  const mergedRecordIds = ctx.mergedRecordIds;
  const mergedViewIds = ctx.mergedViewIds;

  await db
    .update(busabaseChangeRequests)
    .set({
      status: "merged",
      mergedAt: timestamp,
      mergeSummary: {
        operationCount: operationKinds.length,
        recordIds: mergedRecordIds,
        viewIds: mergedViewIds,
      },
      updatedAt: timestamp,
    })
    .where(eq(busabaseChangeRequests.id, changeRequest.id));
  await insertAuditEvent(db, {
    action: "change_request.merged",
    actorId: CURRENT_USER_ID,
    baseId: changeRequest.baseId,
    changeRequestId: changeRequest.id,
    metadata: {
      operationCount: operationKinds.length,
      recordIds: mergedRecordIds,
      viewIds: mergedViewIds,
    },
  });

  const updatedChangeRequest = await getChangeRequest(changeRequest.id);
  const [record] =
    mergedRecordIds.length > 0
      ? await db
          .select()
          .from(busabaseRecords)
          .where(eq(busabaseRecords.id, mergedRecordIds[0]))
          .limit(1)
      : [];
  const [view] =
    mergedViewIds.length > 0
      ? await db.select().from(busabaseViews).where(eq(busabaseViews.id, mergedViewIds[0])).limit(1)
      : [];
  if (!updatedChangeRequest) {
    throw new Error("Failed to merge changeRequest");
  }
  return {
    changeRequest: updatedChangeRequest,
    record: record ? await hydrateRecord(record) : null,
    view: view ? toViewVO(view) : null,
  };
};

const toSearchText = (fields: Record<string, unknown>) =>
  Object.entries(fields)
    .map(
      ([fieldSlug, value]) =>
        `${fieldSlug} ${typeof value === "string" ? value : JSON.stringify(value)}`,
    )
    .join(" ");

// A record's display title is its base's PRIMARY field value (the first field by
// position — Airtable/Baserow convention), not a hard-coded title/name guess.
export const recordPrimaryText = (record: RecordVO): string => {
  const primarySlug = record.base.fields[0]?.slug;
  return (primarySlug ? String(record.headCommit.fields[primarySlug] ?? "") : "") || record.id;
};

const toRecordSearchResult = (record: RecordVO): SearchResultVO => ({
  id: record.id,
  kind: "record",
  title: recordPrimaryText(record),
  body: String(record.headCommit.fields.body ?? record.headCommit.fields.description ?? ""),
  eyebrow: `${record.base.name} · canonical record`,
  href: `/base/${record.base.slug}/${record.id}`,
  updatedAt: record.updatedAt,
});

const toChangeRequestSearchResult = (changeRequest: ChangeRequestVO): SearchResultVO => ({
  id: changeRequest.id,
  kind: "change_request",
  title:
    changeRequest.operationCount > 1
      ? `${changeRequest.operationCount} operation changeRequest`
      : String(
          changeRequest.primaryOperation?.headCommit.fields.title ??
            changeRequest.primaryOperation?.headCommit.fields.name ??
            changeRequest.id,
        ),
  body: changeRequest.operations
    .map((operation) => toSearchText(operation.headCommit.fields))
    .join(" "),
  eyebrow: `${changeRequest.base?.name ?? changeRequest.node?.name ?? "Node tree"} · ${changeRequest.status}`,
  href: `/inbox/${changeRequest.id}`,
  updatedAt: changeRequest.updatedAt,
});

const toBaseSearchResult = (base: BaseVO): SearchResultVO => ({
  id: base.id,
  kind: "base",
  title: base.name,
  body: `${base.description} ${base.fields.map((field) => `${field.name} ${field.slug}`).join(" ")}`,
  eyebrow: `${base.fields.length} fields · ${base.slug}`,
  href: `/base/${base.slug}`,
  updatedAt: base.createdAt,
});

export const searchBusabase = async (
  input?: z.input<typeof searchInputSchema>,
): Promise<SearchResponseVO> => {
  await ensureReady();
  const db = await getDb();
  const parsed = searchInputSchema.parse(input);
  const query = parsed.query.trim();
  if (!query) {
    return {
      hasMore: false,
      limit: parsed.limit,
      offset: parsed.offset,
      query,
      results: [],
    };
  }

  const pageSize = parsed.limit + 1;
  const pattern = `%${query}%`;
  const spaceId = getContextSpaceId();
  const textSearch = sql`to_tsvector('simple', coalesce(${busabaseFieldValues.valueText}, '')) @@ plainto_tsquery('simple', ${query})`;

  const projectionRows = await db
    .select({
      changeRequestId: busabaseFieldValues.changeRequestId,
      recordId: busabaseFieldValues.recordId,
    })
    .from(busabaseFieldValues)
    .where(
      and(
        eq(busabaseFieldValues.spaceId, spaceId),
        isNotNull(busabaseFieldValues.valueText),
        or(
          textSearch,
          ilike(busabaseFieldValues.valueText, pattern),
          ilike(busabaseFieldValues.fieldSlug, pattern),
        ),
      ),
    )
    .groupBy(busabaseFieldValues.recordId, busabaseFieldValues.changeRequestId)
    .orderBy(
      desc(
        sql`max(ts_rank(to_tsvector('simple', coalesce(${busabaseFieldValues.valueText}, '')), plainto_tsquery('simple', ${query})))`,
      ),
      desc(sql`max(${busabaseFieldValues.updatedAt})`),
    )
    .limit(pageSize)
    .offset(parsed.offset);

  const recordIds = projectionRows
    .map((row) => row.recordId)
    .filter((recordId): recordId is string => Boolean(recordId));
  const changeRequestIds = projectionRows
    .map((row) => row.changeRequestId)
    .filter((changeRequestId): changeRequestId is string => Boolean(changeRequestId));

  const [recordRows, changeRequestRows, baseRows, fieldRows] = await Promise.all([
    recordIds.length > 0
      ? db
          .select()
          .from(busabaseRecords)
          .where(and(inArray(busabaseRecords.id, recordIds), eq(busabaseRecords.status, "active")))
      : Promise.resolve([]),
    changeRequestIds.length > 0
      ? db
          .select()
          .from(busabaseChangeRequests)
          .where(inArray(busabaseChangeRequests.id, changeRequestIds))
      : Promise.resolve([]),
    parsed.offset === 0
      ? db
          .select()
          .from(busabaseBases)
          .where(
            and(
              eq(busabaseBases.spaceId, spaceId),
              or(
                ilike(busabaseBases.name, pattern),
                ilike(busabaseBases.description, pattern),
                ilike(busabaseBases.slug, pattern),
              ),
            ),
          )
      : Promise.resolve([]),
    parsed.offset === 0
      ? db
          .select()
          .from(busabaseBaseFields)
          .where(
            and(
              eq(busabaseBaseFields.spaceId, spaceId),
              or(ilike(busabaseBaseFields.name, pattern), ilike(busabaseBaseFields.slug, pattern)),
            ),
          )
      : Promise.resolve([]),
  ]);

  const baseIdsFromFields = fieldRows.map((field) => field.baseId);
  const extraBaseRows =
    baseIdsFromFields.length > 0
      ? await db.select().from(busabaseBases).where(inArray(busabaseBases.id, baseIdsFromFields))
      : [];
  const baseRowsById = new Map([...baseRows, ...extraBaseRows].map((base) => [base.id, base]));
  const allBaseIds = [...new Set([...baseRowsById.keys()])];
  const allBaseFields =
    allBaseIds.length > 0
      ? await db
          .select()
          .from(busabaseBaseFields)
          .where(inArray(busabaseBaseFields.baseId, allBaseIds))
      : [];

  const recordsById = new Map(recordRows.map((record) => [record.id, record]));
  const changeRequestsById = new Map(
    changeRequestRows.map((changeRequest) => [changeRequest.id, changeRequest]),
  );
  const projectionResults = await Promise.all(
    projectionRows.slice(0, parsed.limit).flatMap((row) => {
      if (row.recordId) {
        const record = recordsById.get(row.recordId);
        return record ? [hydrateRecord(record).then(toRecordSearchResult)] : [];
      }
      if (row.changeRequestId) {
        const changeRequest = changeRequestsById.get(row.changeRequestId);
        return changeRequest
          ? [hydrateChangeRequest(changeRequest).then(toChangeRequestSearchResult)]
          : [];
      }
      return [];
    }),
  );

  const baseResults = [...baseRowsById.values()].map((base) =>
    toBaseSearchResult(
      toBaseVO(
        base,
        allBaseFields.filter((field) => field.baseId === base.id),
      ),
    ),
  );

  const dedupedResults = new Map<string, SearchResultVO>();
  for (const result of [...projectionResults, ...baseResults]) {
    dedupedResults.set(`${result.kind}:${result.id}`, result);
  }
  const results = [...dedupedResults.values()].slice(0, parsed.limit);

  return {
    hasMore: projectionRows.length > parsed.limit,
    limit: parsed.limit,
    offset: parsed.offset,
    query,
    results,
  };
};

/**
 * Auth verification info for the current request. In the open-source app there
 * are no user/member tables — every request runs as the single local owner of
 * the `local` space — so this synthesizes that local identity from the context
 * defaults. The cloud host (`apps/busabase-cloud`) overrides this handler to
 * return the real space/user/member resolved from the verified user API key.
 */
export const getAuthInfo = (): AuthInfo => {
  const spaceId = getContextSpaceId();
  const actorId = resolveActorId("local-user");
  const isLocal = spaceId === LOCAL_SPACE_ID;
  return {
    space: {
      id: spaceId,
      name: isLocal ? "Local Workspace" : spaceId,
      slug: isLocal ? "local" : null,
      plan: isLocal ? "local" : null,
    },
    user: {
      id: actorId,
      name: isLocal ? "Local User" : actorId,
      email: null,
      image: null,
    },
    member: {
      userId: actorId,
      spaceId,
      role: "owner",
    },
  };
};
