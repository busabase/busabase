import "server-only";

import type {
  BaseVO,
  ChangeRequestStatus,
  NodeVO,
  ViewConfigVO,
  ViewType,
} from "busabase-contract/types";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { iStringToText } from "openlib/i18n/i-string";
import { storage } from "openlib/storage";
import { getContextSpaceId, LOCAL_SPACE_ID } from "../context";
import { getDb } from "../db";
import type { BasePO, NodePO } from "../db/schema";
import {
  attachments,
  busabaseAssets,
  busabaseAssetUsages,
  busabaseBaseFields,
  busabaseBases,
  busabaseChangeRequests,
  busabaseComments,
  busabaseCommits,
  busabaseForms,
  busabaseNodes,
  type busabaseOperationKindEnum,
  busabaseOperations,
  busabaseRecords,
  busabaseReviews,
  busabaseViews,
} from "../db/schema";
import {
  BLOG_APPROVAL_RECORD_ID,
  buildRecordSeedFields,
  COVER_IMAGE_FIXTURE_ASSET_ID,
  COVER_IMAGE_FIXTURE_ATTACHMENT_ID,
  DEMO_BLOG_BASE_NODE_ID,
} from "../demo/dataset";
import { DEMO_GREP_FILE_NODE_ICON, DEMO_ROOT_NODE_ICON, seedNodeIcon } from "../demo/node-icons";
import type {
  SeedCommentDef,
  SeedDocDef,
  SeedFileDef,
  SeedFileTreeDef,
  SeedFolderDef,
  SeedFormDef,
  SeedRichNodeDef,
  SeedScenario,
} from "../demo/seed-types";
import { writeDocBody } from "../domains/doc/handlers";
import { writeFileTreeTextFile } from "../domains/filetree/handlers";
import { insertCommit } from "./commits";
import { projectCommitFields, refreshRecordQueryStatistics } from "./field-values";
import {
  CURRENT_USER_ID,
  hashBuffer,
  hashText,
  id,
  now,
  ROOT_NODE_ID,
  rootNodeIdForSpace,
} from "./kernel";
import { toBaseVO, toNodeVO } from "./vo";

const minutesBefore = (date: Date, minutes: number) => new Date(date.getTime() - minutes * 60_000);

const globalForStore = globalThis as typeof globalThis & {
  /** Per-space readiness, so each space bootstraps its root exactly once. */
  __busabaseReadyBySpace?: Map<string, Promise<void>>;
};

// ── Interfaces ────────────────────────────────────────────────────────────────

type DbOperationKind = (typeof busabaseOperationKindEnum.enumValues)[number];

interface SeedRecordInput {
  id: string;
  baseId: string;
  commitId: string;
  naturalKey?: {
    fields: Record<string, string>;
  };
  fields: Record<string, unknown>;
  message: string;
  author: string;
  createdBy: string;
  createdAt: Date;
}

interface SeedOperationKindInput {
  id: string;
  commitId: string;
  operation: DbOperationKind;
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
    operation: DbOperationKind;
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
  type?: ViewType;
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
        type: input.type ?? "table",
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
    type: input.type ?? "table",
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
    const commitId = existingRecord.headCommitId;
    await db
      .update(busabaseCommits)
      .set({ payload: input.fields })
      .where(eq(busabaseCommits.id, commitId));
    await projectCommitFields({
      baseId: input.baseId,
      commitId,
      recordId: input.id,
      fields: input.fields,
    });
    return;
  }

  await insertCommit(db, {
    id: input.commitId,
    baseId: input.baseId,
    operationId: null,
    parentCommitId: null,
    payload: input.fields,
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

const resolveSeedRecordIdentity = async (input: {
  id: string;
  baseId: string;
  commitId: string;
  naturalKey?: SeedRecordInput["naturalKey"];
}) => {
  const db = await getDb();
  const [existingById] = await db
    .select({ id: busabaseRecords.id, headCommitId: busabaseRecords.headCommitId })
    .from(busabaseRecords)
    .where(eq(busabaseRecords.id, input.id))
    .limit(1);
  if (existingById) {
    return { recordId: existingById.id, commitId: existingById.headCommitId };
  }
  if (!input.naturalKey) {
    return { recordId: input.id, commitId: input.commitId };
  }

  const candidates = await db
    .select({
      recordId: busabaseRecords.id,
      commitId: busabaseRecords.headCommitId,
      fields: busabaseCommits.payload,
    })
    .from(busabaseRecords)
    .innerJoin(busabaseCommits, eq(busabaseCommits.id, busabaseRecords.headCommitId))
    .where(eq(busabaseRecords.baseId, input.baseId));
  const naturalKeyFields = Object.entries(input.naturalKey.fields);
  const matches = candidates.filter((candidate) =>
    naturalKeyFields.every(([fieldSlug, value]) => candidate.fields[fieldSlug] === value),
  );
  if (matches.length > 1) {
    throw new Error(
      `Seed natural key ${JSON.stringify(input.naturalKey.fields)} is not unique in Base ${input.baseId}`,
    );
  }
  return matches[0]
    ? { recordId: matches[0].recordId, commitId: matches[0].commitId }
    : { recordId: input.id, commitId: input.commitId };
};

const remapSeedIds = (value: unknown, actualIdBySeedId: ReadonlyMap<string, string>): unknown => {
  if (typeof value === "string") return actualIdBySeedId.get(value) ?? value;
  if (Array.isArray(value)) {
    return value.map((item) => remapSeedIds(item, actualIdBySeedId));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, remapSeedIds(item, actualIdBySeedId)]),
    );
  }
  return value;
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
          .set({ payload: operation.fields })
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
    await insertCommit(db, {
      id: operation.commitId,
      baseId: input.baseId,
      operationId: null,
      parentCommitId: operation.baseCommitId ?? operation.sourceCommitId ?? null,
      payload: operation.fields,
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
      .set({ payload: input.operation.fields })
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

  await insertCommit(db, {
    id: input.operation.commitId,
    baseId: null,
    targetType: "node",
    nodeId: input.nodeId,
    operationId: null,
    parentCommitId: null,
    payload: input.operation.fields,
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
  // `/api/storage` is the route pair that actually serves and receives local
  // files in every build (apps/busabase/src/app/api/storage/[...key] for reads,
  // /api/storage/upload for writes) — unlike `/api/dev/*`, which 404s in
  // production. Launchers (CLI / desktop / Docker) set STORAGE_URL explicitly;
  // this is only the last-resort fallback for a bare dev process.
  process.env.STORAGE_URL ??= `local://${process.cwd()}/.data/busabase-storage?base_url=/api/storage&upload_url=/api/storage/upload`;
};

const DOCS_FOLDER_NODE_ID = "nod_docs";
const FILES_FOLDER_NODE_ID = "nod_files";

interface FileTreeFolderConfig {
  folderNodeId: string;
  slug: string;
  name: string;
  description: string;
  position: number;
  /**
   * The entry file for nodes of this kind (e.g. "SKILL.md", "package.json").
   * It belongs to the KIND, not to any one node — it is read straight off this
   * config, never off a node's `metadata`.
   */
  entryFile: string;
}

// One sidebar folder per file-tree kind (Skill/Drive/AirApp), each created
// lazily the first time a scenario actually seeds a node of that kind.
const FILE_TREE_FOLDER_CONFIG: Record<SeedFileTreeDef["nodeType"], FileTreeFolderConfig> = {
  skill: {
    folderNodeId: "nod_skills",
    slug: "skills",
    name: "Agent Skills",
    description: "Versioned Skill folders that agents can read and update through review.",
    position: 1,
    entryFile: "SKILL.md",
  },
  drive: {
    folderNodeId: "nod_drives",
    slug: "drives",
    name: "Drives",
    description: "Pure file-tree Drives managed through review.",
    position: 2,
    entryFile: "README.md",
  },
  airapp: {
    folderNodeId: "nod_airapps",
    slug: "airapps",
    name: "AirApps",
    description: "Runnable AirApp projects managed through review.",
    position: 5,
    entryFile: "package.json",
  },
};

/**
 * Skill, Drive, and AirApp nodes are all the same shape under the hood — a
 * folder-scoped file-tree node whose files are written through
 * `writeFileTreeTextFile` — so one generic, scenario-driven seeder replaces
 * what used to be `seedSkillNodeIfMissing`/`seedDriveNodeIfMissing` (each
 * hardcoding its own fixed content, with no AirApp equivalent at all).
 * Idempotent per def, keyed by `def.nodeId`, exactly like the two functions
 * it replaces.
 */
const seedFileTreeNodesIfMissing = async (createdAt: Date, defs: SeedFileTreeDef[]) => {
  if (defs.length === 0) {
    return;
  }
  ensureDefaultStorageUrl();
  const db = await getDb();
  const spaceId = getContextSpaceId();

  const neededFolderTypes = new Set(defs.map((def) => def.nodeType));
  const actualFolderIdByNodeType = new Map<SeedFileTreeDef["nodeType"], string>();
  for (const nodeType of neededFolderTypes) {
    const folderConfig = FILE_TREE_FOLDER_CONFIG[nodeType];
    const [existingFolder] = await db
      .select({ id: busabaseNodes.id })
      .from(busabaseNodes)
      .where(
        and(
          eq(busabaseNodes.spaceId, spaceId),
          eq(busabaseNodes.type, "folder"),
          eq(busabaseNodes.slug, folderConfig.slug),
          isNull(busabaseNodes.archivedAt),
        ),
      )
      .limit(1);
    if (!existingFolder) {
      await db.insert(busabaseNodes).values({
        id: folderConfig.folderNodeId,
        parentId: rootNodeIdForSpace(spaceId),
        type: "folder",
        slug: folderConfig.slug,
        name: folderConfig.name,
        description: folderConfig.description,
        icon: seedNodeIcon({ ...folderConfig, nodeType: "folder" }),
        position: folderConfig.position,
        createdAt,
        updatedAt: createdAt,
      });
    } else {
      await db
        .update(busabaseNodes)
        .set({
          icon: seedNodeIcon({ ...folderConfig, nodeType: "folder" }),
          updatedAt: createdAt,
        })
        .where(and(eq(busabaseNodes.spaceId, spaceId), eq(busabaseNodes.id, existingFolder.id)));
    }
    actualFolderIdByNodeType.set(nodeType, existingFolder?.id ?? folderConfig.folderNodeId);
  }

  for (const def of defs) {
    const folderConfig = FILE_TREE_FOLDER_CONFIG[def.nodeType];
    const folderNodeId = actualFolderIdByNodeType.get(def.nodeType) ?? folderConfig.folderNodeId;
    const metadata = {
      entryFile: folderConfig.entryFile,
      visibility: "workspace" as const,
      version: "0.1.0",
    };
    const [existingNode] = await db
      .select()
      .from(busabaseNodes)
      .where(and(eq(busabaseNodes.spaceId, spaceId), eq(busabaseNodes.id, def.nodeId)))
      .limit(1);
    if (existingNode) {
      await db
        .update(busabaseNodes)
        .set({
          parentId: folderNodeId,
          type: def.nodeType,
          slug: def.slug,
          name: def.name,
          description: def.description,
          icon: seedNodeIcon({ ...def, nodeType: def.nodeType }),
          metadata,
          updatedAt: createdAt,
        })
        .where(and(eq(busabaseNodes.spaceId, spaceId), eq(busabaseNodes.id, def.nodeId)));
    } else {
      await db.insert(busabaseNodes).values({
        id: def.nodeId,
        parentId: folderNodeId,
        type: def.nodeType,
        slug: def.slug,
        name: def.name,
        description: def.description,
        icon: seedNodeIcon({ ...def, nodeType: def.nodeType }),
        metadata,
        position: def.position,
        createdAt,
        updatedAt: createdAt,
      });
    }

    const [node] = await db
      .select()
      .from(busabaseNodes)
      .where(and(eq(busabaseNodes.spaceId, spaceId), eq(busabaseNodes.id, def.nodeId)))
      .limit(1);
    if (!node) {
      throw new Error(`Failed to seed ${def.nodeType} node: ${def.nodeId}`);
    }

    for (const file of def.files) {
      await writeFileTreeTextFile(node, file.path, file.content);
    }

    if (def.changeRequest) {
      const cr = def.changeRequest;
      const baseFile = def.files.find((file) => file.path === cr.filePath);
      await seedNodeChangeRequestIfMissing({
        id: cr.id,
        nodeId: node.id,
        status: "in_review",
        submittedBy: cr.submittedBy,
        sourceMeta: {
          seed: true,
          scenario: cr.scenario,
          workflow: cr.workflow,
          subject: def.nodeType,
          nodeId: node.id,
        },
        createdAt: minutesBefore(createdAt, cr.minutesAgo),
        operation: {
          id: cr.operationId,
          commitId: cr.commitId,
          operation: `${def.nodeType}_file_update` as DbOperationKind,
          filePath: cr.filePath,
          fields: {
            filePath: cr.filePath,
            baseContentHash: baseFile ? hashText(baseFile.content) : null,
            nextContent: cr.nextContent,
          },
          message: cr.message,
          author: cr.submittedBy,
        },
      });
    }
  }
};

/** Upsert metadata-backed visual nodes by their stable scenario ids. */
const seedRichNodesIfMissing = async (createdAt: Date, defs: SeedRichNodeDef[]) => {
  if (defs.length === 0) return;
  const db = await getDb();

  for (const def of defs) {
    const values = {
      parentId: def.folderNodeId,
      type: def.nodeType,
      slug: def.slug,
      name: def.name,
      description: def.description,
      icon: seedNodeIcon({ ...def, nodeType: def.nodeType }),
      metadata: def.metadata,
      position: def.position,
      updatedAt: createdAt,
    };
    const [existingNode] = await db
      .select({ id: busabaseNodes.id })
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, def.nodeId))
      .limit(1);
    if (existingNode) {
      await db.update(busabaseNodes).set(values).where(eq(busabaseNodes.id, def.nodeId));
    } else {
      await db.insert(busabaseNodes).values({
        id: def.nodeId,
        ...values,
        createdAt,
      });
    }
  }
};

const seedFormNodesIfMissing = async (createdAt: Date, defs: SeedFormDef[]) => {
  if (defs.length === 0) return;
  const db = await getDb();
  const spaceId = getContextSpaceId();

  for (const def of defs) {
    const nodeValues = {
      parentId: def.folderNodeId,
      type: "form" as const,
      slug: def.slug,
      name: def.name,
      description: def.description,
      icon: seedNodeIcon({ ...def, nodeType: "form" }),
      position: def.position,
      updatedAt: createdAt,
    };
    const [existingNode] = await db
      .select({ id: busabaseNodes.id })
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, def.nodeId))
      .limit(1);
    if (existingNode) {
      await db.update(busabaseNodes).set(nodeValues).where(eq(busabaseNodes.id, def.nodeId));
    } else {
      await db.insert(busabaseNodes).values({ id: def.nodeId, ...nodeValues, createdAt });
    }

    const formValues = {
      spaceId,
      nodeId: def.nodeId,
      targetBaseId: def.targetBaseId,
      name: def.name,
      description: def.description,
      bindings: def.bindings,
      page: def.page ?? {},
      createdBy: CURRENT_USER_ID,
      updatedAt: createdAt,
    };
    const [existingForm] = await db
      .select({ id: busabaseForms.id })
      .from(busabaseForms)
      .where(eq(busabaseForms.id, def.formId))
      .limit(1);
    if (existingForm) {
      await db.update(busabaseForms).set(formValues).where(eq(busabaseForms.id, def.formId));
    } else {
      await db.insert(busabaseForms).values({ id: def.formId, ...formValues, createdAt });
    }
  }
};

// ── Per-node-type example content (Docs, Files) + review Comments ──────────────
// The content itself is locale-specific and lives in the scenario
// (`scenario.docs` / `scenario.files` / `scenario.comments`), so English and
// Simplified Chinese share this seeding structure but carry different data.

const seedDocNodesIfMissing = async (createdAt: Date, docs: SeedDocDef[]) => {
  if (docs.length === 0) {
    return;
  }
  ensureDefaultStorageUrl();
  const db = await getDb();
  const [existingFolder] = await db
    .select()
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, DOCS_FOLDER_NODE_ID))
    .limit(1);
  if (!existingFolder) {
    await db.insert(busabaseNodes).values({
      id: DOCS_FOLDER_NODE_ID,
      parentId: ROOT_NODE_ID,
      type: "folder",
      slug: "docs",
      name: "Docs",
      description: "Long-form Markdown documents edited through review.",
      icon: seedNodeIcon({ name: "Docs", nodeType: "folder", slug: "docs" }),
      position: 3,
      createdAt,
      updatedAt: createdAt,
    });
  } else {
    await db
      .update(busabaseNodes)
      .set({
        icon: seedNodeIcon({ name: "Docs", nodeType: "folder", slug: "docs" }),
        updatedAt: createdAt,
      })
      .where(eq(busabaseNodes.id, DOCS_FOLDER_NODE_ID));
  }

  for (const doc of docs) {
    const [existingDoc] = await db
      .select()
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, doc.nodeId))
      .limit(1);
    const values = {
      parentId: DOCS_FOLDER_NODE_ID,
      type: "doc" as const,
      slug: doc.slug,
      name: doc.name,
      description: doc.description,
      icon: seedNodeIcon({ ...doc, nodeType: "doc" }),
    };
    if (existingDoc) {
      await db
        .update(busabaseNodes)
        .set({ ...values, updatedAt: createdAt })
        .where(eq(busabaseNodes.id, doc.nodeId));
    } else {
      await db.insert(busabaseNodes).values({
        id: doc.nodeId,
        ...values,
        position: doc.position,
        createdAt,
        updatedAt: createdAt,
      });
    }
    await writeDocBody(doc.nodeId, doc.body);

    if (doc.changeRequest) {
      const cr = doc.changeRequest;
      await seedNodeChangeRequestIfMissing({
        id: cr.id,
        nodeId: doc.nodeId,
        status: "in_review",
        submittedBy: cr.submittedBy,
        sourceMeta: {
          seed: true,
          scenario: "doc-body-update",
          subject: "doc",
          nodeId: doc.nodeId,
        },
        createdAt: minutesBefore(createdAt, cr.minutesAgo),
        operation: {
          id: cr.operationId,
          commitId: cr.commitId,
          operation: "doc_update",
          filePath: null,
          fields: { body: cr.nextBody },
          message: cr.message,
          author: cr.submittedBy,
        },
      });
    }
  }
};

/**
 * Ensure the "Files" folder (parent of every first-class File node) exists.
 * Shared by `seedFileNodesIfMissing` (gated on the scenario having files) and
 * `seedGrepDemoFixture` (which seeds a File node unconditionally, even for a
 * scenario/test with an empty `files` list — it must not assume the other
 * function already created this folder).
 */
const ensureFilesFolder = async (createdAt: Date) => {
  const db = await getDb();
  const [existingFolder] = await db
    .select()
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, FILES_FOLDER_NODE_ID))
    .limit(1);
  if (!existingFolder) {
    await db
      .insert(busabaseNodes)
      .values({
        id: FILES_FOLDER_NODE_ID,
        parentId: ROOT_NODE_ID,
        type: "folder",
        slug: "files",
        name: "Files",
        description: "First-class uploaded files backed by the Asset library.",
        icon: seedNodeIcon({ name: "Files", nodeType: "folder", slug: "files" }),
        position: 4,
        createdAt,
        updatedAt: createdAt,
      })
      .onConflictDoNothing();
  } else {
    await db
      .update(busabaseNodes)
      .set({
        icon: seedNodeIcon({ name: "Files", nodeType: "folder", slug: "files" }),
        updatedAt: createdAt,
      })
      .where(eq(busabaseNodes.id, FILES_FOLDER_NODE_ID));
  }
};

const seedFileNodesIfMissing = async (createdAt: Date, files: SeedFileDef[]) => {
  if (files.length === 0) {
    return;
  }
  ensureDefaultStorageUrl();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  await ensureFilesFolder(createdAt);

  for (const file of files) {
    const [existingFile] = await db
      .select()
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, file.nodeId))
      .limit(1);
    if (existingFile) {
      await db
        .update(busabaseNodes)
        .set({ icon: seedNodeIcon({ ...file, nodeType: "file" }), updatedAt: createdAt })
        .where(eq(busabaseNodes.id, file.nodeId));
      continue;
    }

    const buffer = Buffer.from(file.body, "utf8");
    await storage.uploadFileToKey(buffer, file.storageKey, file.mimeType);

    // Attachment = the deduped physical bytes; Asset = the space-scoped logical handle
    // a File node points at. Both keyed by fixed ids so a re-run is a no-op.
    const [existingAttachment] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, file.attachmentId))
      .limit(1);
    if (!existingAttachment) {
      await db.insert(attachments).values({
        id: file.attachmentId,
        storageKey: file.storageKey,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: buffer.length,
        contentHash: null,
        context: "file-node",
        userId: CURRENT_USER_ID,
        spaceId,
        metadata: {},
        createdAt,
        updatedAt: createdAt,
      });
    }

    const [existingAsset] = await db
      .select()
      .from(busabaseAssets)
      .where(eq(busabaseAssets.id, file.assetId))
      .limit(1);
    if (!existingAsset) {
      await db.insert(busabaseAssets).values({
        id: file.assetId,
        spaceId,
        attachmentId: file.attachmentId,
        name: file.fileName,
        contentKind: "text",
        metadata: {},
        createdBy: CURRENT_USER_ID,
        createdAt,
        updatedAt: createdAt,
      });
    }

    await db.insert(busabaseNodes).values({
      id: file.nodeId,
      parentId: FILES_FOLDER_NODE_ID,
      type: "file",
      slug: file.slug,
      name: file.name,
      description: file.description,
      icon: seedNodeIcon({ ...file, nodeType: "file" }),
      metadata: { assetId: file.assetId },
      position: file.position,
      createdAt,
      updatedAt: createdAt,
    });

    // Where-used row so the Asset shows the File node as a reference (guards deletion).
    await db
      .insert(busabaseAssetUsages)
      .values({
        id: id("aus"),
        spaceId,
        assetId: file.assetId,
        ownerType: "file_node",
        nodeId: file.nodeId,
        path: "",
        recordId: "",
        fieldSlug: "file:asset",
        blockId: "",
        metadata: {},
        createdAt,
        updatedAt: createdAt,
      })
      .onConflictDoNothing();
  }
};

const GREP_DEMO_NODE_ID = "nod_grep_demo_invoice";
const GREP_DEMO_ATTACHMENT_ID = "att_grep_demo_invoice_pdf";
const GREP_DEMO_ASSET_ID = "ast_grep_demo_invoice";
const GREP_DEMO_STORAGE_KEY = "files/seed/grep-demo-invoice.pdf";

/**
 * Drive Grep Retrieval demo fixture: a small binary (PDF) File node whose text
 * is supplied through the REAL `putText` code path — simulating exactly what
 * an external agent does after running its own extractor. Busabase never
 * parses PDFs (see the spec's "no extraction library, ever" boundary); the
 * bytes here just need to look like a PDF, not be read as one.
 *
 * Idempotent (checked by fixed node id) so `pnpm db:seed` stays re-runnable.
 * Together with `seedFileNodesIfMissing`'s text-kind files (auto-registered,
 * no writer needed), this makes the demo dataset immediately greppable end to
 * end: `grep({ pattern: "ACME Corp", sources: ["files"] })` finds a hit in
 * this fixture, and the same call for `signups` finds a plain CSV/text File.
 */
const seedGrepDemoFixture = async (createdAt: Date) => {
  ensureDefaultStorageUrl();
  const db = await getDb();
  const spaceId = getContextSpaceId();

  const [existing] = await db
    .select({ id: busabaseNodes.id })
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, GREP_DEMO_NODE_ID))
    .limit(1);
  if (existing) {
    await db
      .update(busabaseNodes)
      .set({ icon: DEMO_GREP_FILE_NODE_ICON, updatedAt: createdAt })
      .where(eq(busabaseNodes.id, GREP_DEMO_NODE_ID));
    return;
  }
  // Independent of `seedFileNodesIfMissing` — this fixture seeds unconditionally
  // even when the scenario's own `files` list is empty, so it can't assume that
  // function already created the "Files" folder.
  await ensureFilesFolder(createdAt);

  const { buildMinimalPdfBuffer, GREP_DEMO_EXTRACTED_TEXT, GREP_DEMO_FIXTURE_FILE_NAME } =
    await import("../demo/grep-fixture");
  const pdfBuffer = buildMinimalPdfBuffer();
  await storage.uploadFileToKey(pdfBuffer, GREP_DEMO_STORAGE_KEY, "application/pdf");

  await db
    .insert(attachments)
    .values({
      id: GREP_DEMO_ATTACHMENT_ID,
      storageKey: GREP_DEMO_STORAGE_KEY,
      fileName: GREP_DEMO_FIXTURE_FILE_NAME,
      mimeType: "application/pdf",
      sizeBytes: pdfBuffer.length,
      contentHash: hashBuffer(pdfBuffer),
      context: "file-node",
      userId: CURRENT_USER_ID,
      spaceId,
      metadata: {},
      createdAt,
      updatedAt: createdAt,
    })
    .onConflictDoNothing();

  await db
    .insert(busabaseAssets)
    .values({
      id: GREP_DEMO_ASSET_ID,
      spaceId,
      attachmentId: GREP_DEMO_ATTACHMENT_ID,
      name: GREP_DEMO_FIXTURE_FILE_NAME,
      contentKind: "binary",
      metadata: {},
      createdBy: CURRENT_USER_ID,
      createdAt,
      updatedAt: createdAt,
    })
    .onConflictDoNothing();

  await db.insert(busabaseNodes).values({
    id: GREP_DEMO_NODE_ID,
    parentId: FILES_FOLDER_NODE_ID,
    type: "file",
    slug: "globex-cloud-invoice-2026-06-demo",
    name: "Globex Cloud Invoice (grep demo)",
    description: "Drive Grep Retrieval demo fixture — a binary PDF with agent-supplied text.",
    icon: DEMO_GREP_FILE_NODE_ICON,
    metadata: { assetId: GREP_DEMO_ASSET_ID },
    position: 100,
    createdAt,
    updatedAt: createdAt,
  });

  await db
    .insert(busabaseAssetUsages)
    .values({
      id: id("aus"),
      spaceId,
      assetId: GREP_DEMO_ASSET_ID,
      ownerType: "file_node",
      nodeId: GREP_DEMO_NODE_ID,
      path: "",
      recordId: "",
      fieldSlug: "file:asset",
      blockId: "",
      metadata: {},
      createdAt,
      updatedAt: createdAt,
    })
    .onConflictDoNothing();

  // The part that matters: simulate an external agent supplying extracted
  // text for a binary asset, through the SAME public `putText` logic every
  // other writer uses — no shortcut, no direct row insert.
  const { putAssetText } = await import("../domains/assets/logic/asset-texts-logic");
  await putAssetText({ assetId: GREP_DEMO_ASSET_ID, text: GREP_DEMO_EXTRACTED_TEXT });
};

/**
 * Real binary-image demo fixture: every other `cover_image` in `demo/dataset.ts`
 * is a plain string `url` placeholder that never touched the attachment/asset
 * pipeline. This seeds one real, decodable PNG through the same
 * attachment + asset (+ where-used) writes `seedFileNodesIfMissing` performs,
 * then wires it to `BLOG_APPROVAL_RECORD_ID`'s `cover_image` field via a real
 * `busabase_asset_usages` row (`ownerType: "base"`) — the same row shape
 * `assets/handlers.ts` maintains for a real merge, just written directly since
 * this is a static seed record rather than a live Change Request merge.
 * Idempotent (checked by fixed attachment id) so `pnpm db:seed` stays re-runnable.
 */
const seedImageAssetFixture = async (createdAt: Date) => {
  const db = await getDb();
  const spaceId = getContextSpaceId();

  const [existing] = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(eq(attachments.id, COVER_IMAGE_FIXTURE_ATTACHMENT_ID))
    .limit(1);
  if (existing) {
    return;
  }

  const { buildMinimalPngBuffer, COVER_IMAGE_FIXTURE_FILE_NAME } = await import(
    "../demo/image-fixture"
  );
  const pngBuffer = buildMinimalPngBuffer();
  const storageKey = "files/seed/blog-cover-agents-demo.png";
  await storage.uploadFileToKey(pngBuffer, storageKey, "image/png");

  await db
    .insert(attachments)
    .values({
      id: COVER_IMAGE_FIXTURE_ATTACHMENT_ID,
      storageKey,
      fileName: COVER_IMAGE_FIXTURE_FILE_NAME,
      mimeType: "image/png",
      sizeBytes: pngBuffer.length,
      contentHash: hashBuffer(pngBuffer),
      context: "base-field",
      userId: CURRENT_USER_ID,
      spaceId,
      metadata: {},
      createdAt,
      updatedAt: createdAt,
    })
    .onConflictDoNothing();

  await db
    .insert(busabaseAssets)
    .values({
      id: COVER_IMAGE_FIXTURE_ASSET_ID,
      spaceId,
      attachmentId: COVER_IMAGE_FIXTURE_ATTACHMENT_ID,
      name: COVER_IMAGE_FIXTURE_FILE_NAME,
      contentKind: "binary",
      metadata: {},
      createdBy: CURRENT_USER_ID,
      createdAt,
      updatedAt: createdAt,
    })
    .onConflictDoNothing();

  await db
    .insert(busabaseAssetUsages)
    .values({
      id: id("aus"),
      spaceId,
      assetId: COVER_IMAGE_FIXTURE_ASSET_ID,
      ownerType: "base",
      nodeId: DEMO_BLOG_BASE_NODE_ID,
      path: "",
      recordId: BLOG_APPROVAL_RECORD_ID,
      fieldSlug: "cover_image",
      blockId: "",
      metadata: {},
      createdAt,
      updatedAt: createdAt,
    })
    .onConflictDoNothing();
};

/**
 * Row count intentionally chosen to be greater than the dump export cursor's
 * page size (`EXPORT_LIMIT = 500` in `dump-roundtrip.test.ts` / the real CLI
 * exporter): before this fixture, `attachments`/`assets`/`assetUsages` never
 * exceeded ~40 rows each, so the dump export's cursor-pagination "there's a
 * next page" branch (`export-logic.ts`'s `nextCursor = rows.length === limit
 * ? ... : null`) was never actually taken for these three tables — only
 * exercised for tables that already happened to be large (e.g. audit events).
 * These rows model "a user bulk-imported a folder of small reference files" —
 * plausible demo content, not throwaway junk — and are inserted in batches
 * (mirroring the real importer's `IMPORT_BATCH = 200`) to stay under
 * Postgres's per-statement bind-parameter ceiling.
 */
const BULK_ATTACHMENT_FIXTURE_COUNT = 502;
const BULK_ATTACHMENT_INSERT_BATCH = 200;

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
};

const seedBulkAttachmentFixtures = async (createdAt: Date) => {
  ensureDefaultStorageUrl();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  await ensureFilesFolder(createdAt);

  const [existing] = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(eq(attachments.id, "att_bulk_import_000"))
    .limit(1);
  if (existing) {
    return;
  }

  // One physical blob, deduped across all 502 rows — `attachments.storageKey`
  // is documented as NOT unique for exactly this reason ("content addressing
  // means many registry rows share one physical key"). Keeps this fixture at
  // a single `storage.uploadFileToKey` call instead of 502 sequential ones
  // (this seed path runs in ~40 test files; 502x that would meaningfully slow
  // the suite for no test value — the dump export/pagination path this
  // fixture exists to exercise only cares about row *count*, not distinct
  // bytes per row).
  const sharedBody = Buffer.from(
    "Bulk-imported reference file.\nUsed only to exercise the dump export's cursor pagination.\n",
    "utf8",
  );
  const sharedStorageKey = "files/seed/bulk-import/bulk-import-reference.txt";
  await storage.uploadFileToKey(sharedBody, sharedStorageKey, "text/plain");
  const sharedContentHash = hashBuffer(sharedBody);

  const attachmentRows: (typeof attachments.$inferInsert)[] = [];
  const assetRows: (typeof busabaseAssets.$inferInsert)[] = [];
  const usageRows: (typeof busabaseAssetUsages.$inferInsert)[] = [];

  for (let i = 0; i < BULK_ATTACHMENT_FIXTURE_COUNT; i += 1) {
    const idx = String(i).padStart(3, "0");
    const attachmentId = `att_bulk_import_${idx}`;
    const assetId = `ast_bulk_import_${idx}`;
    const fileName = `bulk-import-reference-${idx}.txt`;

    attachmentRows.push({
      id: attachmentId,
      storageKey: sharedStorageKey,
      fileName,
      mimeType: "text/plain",
      sizeBytes: sharedBody.length,
      contentHash: sharedContentHash,
      context: "bulk-import",
      userId: CURRENT_USER_ID,
      spaceId,
      metadata: {},
      createdAt,
      updatedAt: createdAt,
    });
    assetRows.push({
      id: assetId,
      spaceId,
      attachmentId,
      name: fileName,
      contentKind: "text",
      metadata: {},
      createdBy: CURRENT_USER_ID,
      createdAt,
      updatedAt: createdAt,
    });
    usageRows.push({
      id: id("aus"),
      spaceId,
      assetId,
      ownerType: "drive",
      nodeId: FILES_FOLDER_NODE_ID,
      path: `/bulk-import/${fileName}`,
      recordId: "",
      fieldSlug: "",
      blockId: "",
      metadata: {},
      createdAt,
      updatedAt: createdAt,
    });
  }

  for (const batch of chunk(attachmentRows, BULK_ATTACHMENT_INSERT_BATCH)) {
    await db.insert(attachments).values(batch).onConflictDoNothing();
  }
  for (const batch of chunk(assetRows, BULK_ATTACHMENT_INSERT_BATCH)) {
    await db.insert(busabaseAssets).values(batch).onConflictDoNothing();
  }
  for (const batch of chunk(usageRows, BULK_ATTACHMENT_INSERT_BATCH)) {
    await db.insert(busabaseAssetUsages).values(batch).onConflictDoNothing();
  }
};

const seedCommentsIfMissing = async (createdAt: Date, comments: SeedCommentDef[]) => {
  if (comments.length === 0) {
    return;
  }
  const db = await getDb();
  for (const comment of comments) {
    const [existing] = await db
      .select()
      .from(busabaseComments)
      .where(eq(busabaseComments.id, comment.id))
      .limit(1);
    if (existing) {
      continue;
    }

    // Resolve the subject links the same way createComment does, so the comment
    // threads correctly under its change request or record.
    let recordId: string | null = null;
    let changeRequestId: string | null = null;
    let commitId: string | null = null;
    if (comment.subjectType === "change_request") {
      const [cr] = await db
        .select({ id: busabaseChangeRequests.id })
        .from(busabaseChangeRequests)
        .where(eq(busabaseChangeRequests.id, comment.subjectId))
        .limit(1);
      if (!cr) {
        continue;
      }
      changeRequestId = cr.id;
    } else if (comment.subjectType === "record") {
      const [record] = await db
        .select({ id: busabaseRecords.id, headCommitId: busabaseRecords.headCommitId })
        .from(busabaseRecords)
        .where(eq(busabaseRecords.id, comment.subjectId))
        .limit(1);
      if (!record) {
        continue;
      }
      recordId = record.id;
      commitId = record.headCommitId;
    }

    const commentedAt = minutesBefore(createdAt, comment.minutesAgo);
    await db.insert(busabaseComments).values({
      id: comment.id,
      subjectType: comment.subjectType,
      subjectId: comment.subjectId,
      recordId,
      changeRequestId,
      operationId: null,
      commitId,
      authorId: comment.authorId,
      body: comment.body,
      mentionsAi: comment.mentionsAi ?? false,
      createdAt: commentedAt,
      updatedAt: commentedAt,
    });
  }
};

/**
 * Nest a flat row set into a `NodeVO[]` tree, grouped by `parentId`.
 *
 * `options.rootParentId` picks which bucket is the "top" of the returned
 * array — `null` (default) is every existing caller: the space root's own
 * `parentId === null` row. `listNodes`'s bounded per-folder fetch passes an
 * explicit node id instead, to build a forest rooted at THAT node's children
 * from the same flat `nodes` rows (used for the lazy "expand a folder" path,
 * where the folder itself isn't part of `nodes` and only its descendants are).
 *
 * `options.forceHasChildrenIds` marks node ids that must report
 * `hasChildren: true` even though `nodes` doesn't include their children —
 * the depth-boundary case: `listNodes` fetches one extra grouped
 * existence-only query for just the deepest returned level and passes the
 * ids that have real (unfetched) children here, so the sidebar still shows
 * an expand affordance instead of silently rendering them as leaves.
 */
export const buildNodeTree = (
  nodes: NodePO[],
  bases: BasePO[],
  options?: { rootParentId?: string | null; forceHasChildrenIds?: Set<string> },
): NodeVO[] => {
  const rootParentId = options?.rootParentId ?? null;
  const forceHasChildrenIds = options?.forceHasChildrenIds;
  const baseIdByNodeId = new Map(bases.map((base) => [base.nodeId, base.id]));
  const presentIds = new Set(nodes.map((node) => node.id));
  const childrenByParentId = new Map<string | null, NodePO[]>();
  for (const node of nodes) {
    // Orphan promotion: a node whose parent is NOT part of `nodes` is attached
    // at the requested root instead of being silently dropped. `nodes` is
    // already ACL-filtered by the caller, so a missing parent means "an
    // ancestor is hidden from this actor" — and hiding a node the actor was
    // explicitly granted, just because its folder is private, loses content
    // they are entitled to see. Two real cases this covers:
    //   1. Restricted mode: the workspace root has no explicit visibility, so
    //      it filters out and would otherwise take the ENTIRE tree with it —
    //      members got a blank sidebar even for content opened or granted to
    //      them. (The lazy-expand path never had this: `fetchRootNodeRows`
    //      fetches the root unfiltered, i.e. the root is meant to be visible.)
    //   2. A single node granted to someone inside a private folder.
    // `recomputeSpaceNodeAcl` already treats an out-of-set parent as a root;
    // this brings the read path in line with it.
    const parentKey =
      node.parentId === rootParentId || (node.parentId !== null && presentIds.has(node.parentId))
        ? node.parentId
        : rootParentId;
    const siblings = childrenByParentId.get(parentKey) ?? [];
    siblings.push(node);
    childrenByParentId.set(parentKey, siblings);
  }

  const sortNodes = (items: NodePO[]) =>
    items.sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());

  const hydrate = (node: NodePO): NodeVO => {
    const children = sortNodes(childrenByParentId.get(node.id) ?? []).map(hydrate);
    const hasChildren = children.length > 0 || (forceHasChildrenIds?.has(node.id) ?? false);
    return toNodeVO(node, baseIdByNodeId.get(node.id) ?? null, children, hasChildren);
  };

  return sortNodes(childrenByParentId.get(rootParentId) ?? []).map(hydrate);
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
    //
    // No projection backfill on the request path: every write projects at write
    // time (projectCommitFields) and the seed resolves its forward-ref relation
    // links via applySeedScenario's own backfill. Scanning the whole space on the
    // first request after each restart only ever helped a legacy pre-projection
    // DB — which a clean/seeded database never is.
  })();

  readyBySpace.set(spaceId, ready);
  return ready;
};

/**
 * Seeded folders sorted so a parent is always processed before any child that
 * declares it via `parentNodeId` — the insert below needs the parent's
 * resolved (possibly adopted) node id to exist in `actualFolderIdBySeedId`
 * already. Depth-first from the roots, preserving the scenario's own order
 * within each level; any folder left over (a `parentNodeId` pointing outside
 * this scenario, or a cycle someone hand-wrote) is appended unchanged rather
 * than silently dropped — it then falls back to its literal `parentNodeId`,
 * which is exactly what happened before nesting existed.
 */
const orderFoldersParentsFirst = (folders: SeedFolderDef[]): SeedFolderDef[] => {
  const childrenByParent = new Map<string, SeedFolderDef[]>();
  const seedIds = new Set(folders.map((folder) => folder.nodeId));
  const roots: SeedFolderDef[] = [];
  for (const folder of folders) {
    if (folder.parentNodeId && seedIds.has(folder.parentNodeId)) {
      const siblings = childrenByParent.get(folder.parentNodeId) ?? [];
      siblings.push(folder);
      childrenByParent.set(folder.parentNodeId, siblings);
    } else {
      roots.push(folder);
    }
  }
  const ordered: SeedFolderDef[] = [];
  const visited = new Set<string>();
  const visit = (folder: SeedFolderDef) => {
    if (visited.has(folder.nodeId)) return;
    visited.add(folder.nodeId);
    ordered.push(folder);
    for (const child of childrenByParent.get(folder.nodeId) ?? []) visit(child);
  };
  roots.forEach(visit);
  for (const folder of folders) if (!visited.has(folder.nodeId)) ordered.push(folder);
  return ordered;
};

const applySeedScenario = async (scenario: SeedScenario) => {
  const db = await getDb();
  const createdAt = now();

  await db
    .update(busabaseNodes)
    .set({ icon: DEMO_ROOT_NODE_ICON, updatedAt: createdAt })
    .where(eq(busabaseNodes.id, ROOT_NODE_ID));

  const existingNodes = await db.select().from(busabaseNodes);
  const existingNodeById = new Map(existingNodes.map((node) => [node.id, node]));
  const existingNodeByParentSlug = new Map(
    existingNodes.map((node) => [`${node.parentId}:${node.slug}`, node]),
  );
  const actualFolderIdBySeedId = new Map<string, string>();
  const existingFolderMetadataBySeedId = new Map<string, Record<string, unknown>>();

  for (const folder of orderFoldersParentsFirst(scenario.folders ?? [])) {
    // A folder nests under another seeded folder when it declares
    // `parentNodeId`; everything else sits directly under the workspace root.
    // `actualFolderIdBySeedId` is consulted because an adopted legacy folder
    // may live under a different id than the scenario's — `orderFoldersParentsFirst`
    // is what guarantees the parent has already been through this loop.
    const parentNodeId = folder.parentNodeId
      ? (actualFolderIdBySeedId.get(folder.parentNodeId) ?? folder.parentNodeId)
      : ROOT_NODE_ID;
    const existingFolder =
      existingNodeById.get(folder.nodeId) ??
      existingNodeByParentSlug.get(`${parentNodeId}:${folder.slug}`);
    if (existingFolder) {
      // `parentId` is deliberately NOT re-applied on an existing folder:
      // re-seeding an already-populated workspace would otherwise yank a
      // folder the user has since moved back to where the scenario put it.
      // Nesting therefore takes effect on the insert path (a fresh workspace,
      // or a folder this scenario is adding for the first time).
      await db
        .update(busabaseNodes)
        .set({
          name: folder.name,
          description: folder.description,
          icon: seedNodeIcon({ ...folder, nodeType: "folder" }),
          position: folder.position,
          updatedAt: createdAt,
        })
        .where(eq(busabaseNodes.id, existingFolder.id));
      actualFolderIdBySeedId.set(folder.nodeId, existingFolder.id);
      existingFolderMetadataBySeedId.set(folder.nodeId, existingFolder.metadata ?? {});
    } else {
      await db.insert(busabaseNodes).values({
        id: folder.nodeId,
        parentId: parentNodeId,
        type: "folder",
        slug: folder.slug,
        name: folder.name,
        description: folder.description,
        icon: seedNodeIcon({ ...folder, nodeType: "folder" }),
        metadata: {},
        position: folder.position,
        createdAt,
        updatedAt: createdAt,
      });
      actualFolderIdBySeedId.set(folder.nodeId, folder.nodeId);
      existingFolderMetadataBySeedId.set(folder.nodeId, {});
    }
  }

  const existingBases = await db.select().from(busabaseBases);
  const existingBaseById = new Map(existingBases.map((base) => [base.id, base]));
  const existingBaseBySlug = new Map(existingBases.map((base) => [base.slug, base]));
  const actualBaseIdBySeedId = new Map<string, string>();

  for (const [baseIndex, base] of (scenario.bases ?? []).entries()) {
    const actualFolderNodeId = actualFolderIdBySeedId.get(base.folderNodeId) ?? base.folderNodeId;
    const existingBase = existingBaseById.get(base.id) ?? existingBaseBySlug.get(base.slug);

    const existingBaseNode =
      (existingBase ? existingNodeById.get(existingBase.nodeId) : undefined) ??
      existingNodeById.get(base.nodeId) ??
      existingNodeByParentSlug.get(`${actualFolderNodeId}:${base.slug}`);
    const actualBaseNodeId = existingBaseNode?.id ?? base.nodeId;
    if (existingBaseNode) {
      await db
        .update(busabaseNodes)
        .set({
          parentId: actualFolderNodeId,
          slug: base.slug,
          name: base.name,
          description: base.description,
          icon: seedNodeIcon({ ...base, nodeType: "base" }),
          position: baseIndex,
          updatedAt: createdAt,
        })
        .where(eq(busabaseNodes.id, existingBaseNode.id));
    } else {
      await db.insert(busabaseNodes).values({
        id: base.nodeId,
        parentId: actualFolderNodeId,
        type: "base",
        slug: base.slug,
        name: base.name,
        description: base.description,
        icon: seedNodeIcon({ ...base, nodeType: "base" }),
        position: baseIndex,
        createdAt,
        updatedAt: createdAt,
      });
    }

    if (!existingBase) {
      await db.insert(busabaseBases).values({
        id: base.id,
        nodeId: actualBaseNodeId,
        slug: base.slug,
        name: base.name,
        description: base.description,
        reviewPolicy: { kind: "single", requiredApprovals: 1 },
        createdAt,
      });
    } else {
      await db
        .update(busabaseBases)
        .set({
          nodeId: actualBaseNodeId,
          slug: base.slug,
          name: base.name,
          description: base.description,
        })
        .where(eq(busabaseBases.id, existingBase.id));
    }
    actualBaseIdBySeedId.set(base.id, existingBase?.id ?? base.id);
  }

  // Resolve fields only after every Base identity is known, so relation field
  // options always point at adopted production Base ids rather than seed ids.
  for (const base of scenario.bases ?? []) {
    const actualBaseId = actualBaseIdBySeedId.get(base.id) ?? base.id;
    for (const [index, field] of base.fields.entries()) {
      const [existingField] = await db
        .select()
        .from(busabaseBaseFields)
        .where(
          and(eq(busabaseBaseFields.baseId, actualBaseId), eq(busabaseBaseFields.slug, field.slug)),
        )
        .limit(1);
      const seedOptions = "options" in field ? field.options : {};
      const fieldValues = {
        name: iStringToText(field.name),
        type: field.type,
        required: field.required,
        position: index,
        options: remapSeedIds(seedOptions, actualBaseIdBySeedId) as typeof seedOptions,
      };
      if (existingField) {
        await db
          .update(busabaseBaseFields)
          .set(fieldValues)
          .where(eq(busabaseBaseFields.id, existingField.id));
      } else {
        await db.insert(busabaseBaseFields).values({
          id: field.id,
          baseId: actualBaseId,
          slug: field.slug,
          ...fieldValues,
        });
      }
    }
  }

  // Folder CMS metadata is persisted after Base adoption so consumers receive
  // the actual production ids even when legacy Bases used generated ids.
  for (const folder of scenario.folders ?? []) {
    if (!folder.metadata) continue;
    const actualFolderId = actualFolderIdBySeedId.get(folder.nodeId);
    if (!actualFolderId) continue;
    const metadata = remapSeedIds(folder.metadata, actualBaseIdBySeedId) as Record<string, unknown>;
    await db
      .update(busabaseNodes)
      .set({
        metadata: { ...(existingFolderMetadataBySeedId.get(folder.nodeId) ?? {}), ...metadata },
        updatedAt: createdAt,
      })
      .where(eq(busabaseNodes.id, actualFolderId));
  }

  const actualRecordIdBySeedId = new Map<string, string>();
  const actualCommitIdBySeedCommitId = new Map<string, string>();
  for (const record of scenario.records ?? []) {
    const actualBaseId = actualBaseIdBySeedId.get(record.baseId) ?? record.baseId;
    const identity = await resolveSeedRecordIdentity({
      id: record.id,
      baseId: actualBaseId,
      commitId: record.commitId,
      naturalKey: record.naturalKey,
    });
    actualRecordIdBySeedId.set(record.id, identity.recordId);
    actualCommitIdBySeedCommitId.set(record.commitId, identity.commitId);
  }

  for (const record of scenario.records ?? []) {
    const recordCreatedAt = minutesBefore(createdAt, record.minutesAgo);
    const actualRecordId = actualRecordIdBySeedId.get(record.id) ?? record.id;
    const actualCommitId = actualCommitIdBySeedCommitId.get(record.commitId) ?? record.commitId;
    const actualBaseId = actualBaseIdBySeedId.get(record.baseId) ?? record.baseId;
    await seedRecordIfMissing({
      id: actualRecordId,
      baseId: actualBaseId,
      commitId: actualCommitId,
      fields: remapSeedIds(
        buildRecordSeedFields(record, recordCreatedAt.toISOString()),
        actualRecordIdBySeedId,
      ) as Record<string, unknown>,
      message: record.message,
      author: record.author,
      createdBy: CURRENT_USER_ID,
      createdAt: recordCreatedAt,
    });
  }

  for (const view of scenario.views ?? []) {
    await seedViewIfMissing({
      id: view.id,
      baseId: actualBaseIdBySeedId.get(view.baseId) ?? view.baseId,
      slug: view.slug,
      name: view.name,
      description: view.description,
      type: view.type,
      config: remapSeedIds(view.config, actualRecordIdBySeedId) as ViewConfigVO,
      createdAt: minutesBefore(createdAt, view.minutesAgo),
    });
  }

  for (const changeRequest of scenario.changeRequests ?? []) {
    const changeRequestCreatedAt = minutesBefore(createdAt, changeRequest.minutesAgo);
    await seedChangeRequestIfMissing({
      id: changeRequest.id,
      baseId: actualBaseIdBySeedId.get(changeRequest.baseId) ?? changeRequest.baseId,
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
        operation: operation.operation as DbOperationKind,
        fields: remapSeedIds(operation.fields, actualRecordIdBySeedId) as Record<string, unknown>,
        message: operation.message,
        author: operation.author,
        targetRecordId: operation.targetRecordId
          ? (actualRecordIdBySeedId.get(operation.targetRecordId) ?? operation.targetRecordId)
          : operation.targetRecordId,
        targetViewId: operation.targetViewId,
        sourceRecordId: operation.sourceRecordId
          ? (actualRecordIdBySeedId.get(operation.sourceRecordId) ?? operation.sourceRecordId)
          : operation.sourceRecordId,
        sourceCommitId: operation.sourceCommitId
          ? (actualCommitIdBySeedCommitId.get(operation.sourceCommitId) ?? operation.sourceCommitId)
          : operation.sourceCommitId,
        baseCommitId: operation.baseCommitId
          ? (actualCommitIdBySeedCommitId.get(operation.baseCommitId) ?? operation.baseCommitId)
          : operation.baseCommitId,
        deleteMode: operation.deleteMode,
      })),
    });
  }

  // Resolve seed forward-reference relation links: re-project every seeded record
  // now that ALL records exist. On the first per-record pass projectCommitFields
  // drops a relation link whose target wasn't inserted yet (it only keeps links
  // to existing targets); this second pass, with everything present, rebuilds
  // them. This is scoped to the records the seed just wrote — no whole-space scan.
  const seededRecords = await db
    .select({
      id: busabaseRecords.id,
      baseId: busabaseRecords.baseId,
      headCommitId: busabaseRecords.headCommitId,
    })
    .from(busabaseRecords);
  const headCommitIds = [...new Set(seededRecords.map((record) => record.headCommitId))];
  const commitFieldsById = new Map(
    headCommitIds.length > 0
      ? (
          await db
            .select({ id: busabaseCommits.id, payload: busabaseCommits.payload })
            .from(busabaseCommits)
            .where(inArray(busabaseCommits.id, headCommitIds))
        ).map((commit) => [commit.id, commit.payload])
      : [],
  );
  for (const record of seededRecords) {
    const fields = commitFieldsById.get(record.headCommitId);
    if (fields) {
      await projectCommitFields({
        baseId: record.baseId,
        commitId: record.headCommitId,
        recordId: record.id,
        fields,
      });
    }
  }
};

export const seedScenario = async (scenario: SeedScenario) => {
  await ensureReady();
  await applySeedScenario(scenario);
  // The per-node-type demos (Skill, Drive, AirApp, Doc, File) are opt-in example
  // content: they ship with `pnpm db:seed:all`, not with the first-request
  // auto-seed in ensureReady(). Together with the scenario's folders + bases
  // they make the seeded workspace cover every builtin node type.
  await seedFileTreeNodesIfMissing(now(), scenario.fileTreeNodes ?? []);
  await seedRichNodesIfMissing(now(), scenario.richNodes ?? []);
  // Forms depend on their target Base existing, so seed them after bases/nodes.
  await seedFormNodesIfMissing(now(), scenario.forms ?? []);
  await seedDocNodesIfMissing(now(), scenario.docs ?? []);
  await seedFileNodesIfMissing(now(), scenario.files ?? []);
  // Drive Grep Retrieval demo fixture — binary PDF + agent-supplied text via
  // putText. Runs unconditionally (unlike `seedFileNodesIfMissing`, which
  // early-returns when a scenario has no files), so every scenario pays for
  // this fixture's storage writes + putText call. Isolated in its own
  // try/catch so a storage hiccup seeding THIS fixture can't fail seeding for
  // scenarios that otherwise have nothing to do with the grep demo.
  try {
    await seedGrepDemoFixture(now());
  } catch (error) {
    console.error(
      "[seed] seedGrepDemoFixture failed — continuing without the grep demo fixture:",
      error,
    );
  }
  // Real binary-image fixture for the Blog Posts cover_image field — see
  // `seedImageAssetFixture`'s docstring. Isolated in its own try/catch for the
  // same reason as the grep fixture above: a storage hiccup here must not fail
  // seeding for scenarios unrelated to this fixture.
  try {
    await seedImageAssetFixture(now());
  } catch (error) {
    console.error(
      "[seed] seedImageAssetFixture failed — continuing without the cover-image demo fixture:",
      error,
    );
  }
  // >500 small attachment/asset/asset-usage rows — see `seedBulkAttachmentFixtures`'s
  // docstring for why. Isolated in its own try/catch for the same reason as
  // the other fixtures above.
  try {
    await seedBulkAttachmentFixtures(now());
  } catch (error) {
    console.error(
      "[seed] seedBulkAttachmentFixtures failed — continuing without the bulk attachment demo fixture:",
      error,
    );
  }
  // Comments thread under the change requests above, so they must already exist.
  await seedCommentsIfMissing(now(), scenario.comments ?? []);
  // Seeding is a bulk load straight into the tables, bypassing the merge path
  // that would normally refresh statistics — and on a fresh local database this
  // IS the population step, so without it the planner's very first estimates
  // describe an empty workspace. See `refreshRecordQueryStatistics`.
  await refreshRecordQueryStatistics(await getDb());
};

export const loadBasesByIds = async (baseIds: string[]): Promise<Map<string, BaseVO>> => {
  const db = await getDb();
  if (baseIds.length === 0) {
    return new Map<string, BaseVO>();
  }

  const baseRows = await db.select().from(busabaseBases).where(inArray(busabaseBases.id, baseIds));
  // Soft-deleted fields must NOT reach the VO — `getBase` has always filtered
  // them and this path did not, so the same Base described two different
  // schemas depending on which query loaded it. That leaked into every
  // `RecordVO.base.fields`: `base.fields[0]` (the primary field used by the
  // gallery/kanban card titles and change-request summaries) could be a field
  // the user had already deleted, and a `lookup` hopping through a deleted
  // relation kept resolving stale values instead of going inert. Deleted fields
  // have their own explicit endpoint (`bases.listDeletedFields`).
  const fieldRows = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(inArray(busabaseBaseFields.baseId, baseIds), isNull(busabaseBaseFields.deletedAt)));
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
