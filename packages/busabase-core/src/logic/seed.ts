import "server-only";

import type {
  BaseVO,
  ChangeRequestStatus,
  NodeVO,
  OperationKind,
  ViewConfigVO,
} from "busabase-contract/types";
import { and, eq, inArray } from "drizzle-orm";
import { getContextSpaceId, LOCAL_SPACE_ID } from "../context";
import { getDb } from "../db";
import type { BasePO, NodePO } from "../db/schema";
import {
  busabaseBaseFields,
  busabaseBases,
  busabaseChangeRequests,
  busabaseCommits,
  busabaseNodes,
  busabaseOperations,
  busabaseRecords,
  busabaseReviews,
  busabaseViews,
} from "../db/schema";
import { buildRecordSeedFields } from "../demo/dataset";
import type { SeedScenario } from "../demo/seed-types";
import { skillStoragePrefix, writeSkillTextFile } from "../domains/skill/logic/storage";
import { ensureProjectionBackfill, projectCommitFields } from "./field-values";
import { CURRENT_USER_ID, hashText, id, now, ROOT_NODE_ID, rootNodeIdForSpace } from "./kernel";
import { toBaseVO, toNodeVO } from "./vo";

const minutesBefore = (date: Date, minutes: number) => new Date(date.getTime() - minutes * 60_000);

const globalForStore = globalThis as typeof globalThis & {
  /** Per-space readiness, so each space bootstraps its root exactly once. */
  __busabaseReadyBySpace?: Map<string, Promise<void>>;
};

// ── Interfaces ────────────────────────────────────────────────────────────────

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
  deleteMode?: "archive";
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

// ── Private helpers ───────────────────────────────────────────────────────────

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
  // `/api/dev/attachment` is the route that actually serves local files
  // (apps/busabase/src/app/api/dev/attachment/[...key]); there is no
  // `/api/storage` route. Launchers (CLI / desktop / Docker) set STORAGE_URL
  // explicitly; this is only the last-resort fallback for a bare dev process.
  process.env.STORAGE_URL ??= `local://${process.cwd()}/.data/busabase-storage?base_url=/api/dev/attachment`;
};

const SKILLS_FOLDER_NODE_ID = "nod_skills";
const SEED_RESEARCH_SKILL_NODE_ID = "nod_skill_ai_research_editor";
const SEED_SKILL_CHANGE_REQUEST_ID = "crq_seed_skill_research_editor";
const SEED_SKILL_OPERATION_ID = "opr_seed_skill_research_editor";
const SEED_SKILL_COMMIT_ID = "cmt_seed_skill_research_editor";

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

export const buildNodeTree = (nodes: NodePO[], bases: BasePO[]): NodeVO[] => {
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

    // A fresh workspace starts empty; example content (Bases / records / the
    // Agent Skills demo) comes only from the explicit `pnpm db:seed:all`
    // (seedScenario), not from this first-request auto-seed.
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
  // The "Agent Skills" demo (folder + AI Research Editor skill + its change
  // request) is opt-in example content: it ships with `pnpm db:seed:all`, not
  // with the first-request auto-seed in ensureReady().
  await seedSkillNodeIfMissing(now());
};

export const loadBasesByIds = async (baseIds: string[]): Promise<Map<string, BaseVO>> => {
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
