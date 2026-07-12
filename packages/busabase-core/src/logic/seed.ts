import "server-only";

import type { BaseVO, ChangeRequestStatus, NodeVO, ViewConfigVO } from "busabase-contract/types";
import { and, eq, inArray } from "drizzle-orm";
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
  busabaseNodes,
  type busabaseOperationKindEnum,
  busabaseOperations,
  busabaseRecords,
  busabaseReviews,
  busabaseViews,
} from "../db/schema";
import { buildRecordSeedFields } from "../demo/dataset";
import type {
  SeedCommentDef,
  SeedDocDef,
  SeedFileDef,
  SeedFileTreeDef,
  SeedScenario,
} from "../demo/seed-types";
import { writeDocBody } from "../domains/doc/handlers";
import { writeFileTreeTextFile } from "../domains/filetree/handlers";
import { projectCommitFields } from "./field-values";
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

const DOCS_FOLDER_NODE_ID = "nod_docs";
const FILES_FOLDER_NODE_ID = "nod_files";

interface FileTreeFolderConfig {
  folderNodeId: string;
  slug: string;
  name: string;
  description: string;
  position: number;
  /** Default `metadata.entryFile` for nodes of this kind (e.g. "SKILL.md", "package.json"). */
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

  const neededFolderTypes = new Set(defs.map((def) => def.nodeType));
  for (const nodeType of neededFolderTypes) {
    const folderConfig = FILE_TREE_FOLDER_CONFIG[nodeType];
    const [existingFolder] = await db
      .select()
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, folderConfig.folderNodeId))
      .limit(1);
    if (!existingFolder) {
      await db.insert(busabaseNodes).values({
        id: folderConfig.folderNodeId,
        parentId: ROOT_NODE_ID,
        type: "folder",
        slug: folderConfig.slug,
        name: folderConfig.name,
        description: folderConfig.description,
        position: folderConfig.position,
        createdAt,
        updatedAt: createdAt,
      });
    }
  }

  for (const def of defs) {
    const folderConfig = FILE_TREE_FOLDER_CONFIG[def.nodeType];
    const metadata = {
      entryFile: folderConfig.entryFile,
      visibility: "workspace" as const,
      version: "0.1.0",
    };
    const [existingNode] = await db
      .select()
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, def.nodeId))
      .limit(1);
    if (existingNode) {
      await db
        .update(busabaseNodes)
        .set({
          parentId: folderConfig.folderNodeId,
          type: def.nodeType,
          slug: def.slug,
          name: def.name,
          description: def.description,
          metadata,
          updatedAt: createdAt,
        })
        .where(eq(busabaseNodes.id, def.nodeId));
    } else {
      await db.insert(busabaseNodes).values({
        id: def.nodeId,
        parentId: folderConfig.folderNodeId,
        type: def.nodeType,
        slug: def.slug,
        name: def.name,
        description: def.description,
        metadata,
        position: def.position,
        createdAt,
        updatedAt: createdAt,
      });
    }

    const [node] = await db
      .select()
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, def.nodeId))
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
      position: 3,
      createdAt,
      updatedAt: createdAt,
    });
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
        position: 4,
        createdAt,
        updatedAt: createdAt,
      })
      .onConflictDoNothing();
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
 * end: `assets.grep({ pattern: "ACME Corp" })` finds a hit in this fixture,
 * and `assets.grep({ pattern: "signups" })` finds one in a plain CSV/text File.
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
          name: iStringToText(field.name),
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
          name: iStringToText(field.name),
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
        operation: operation.operation as DbOperationKind,
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
            .select({ id: busabaseCommits.id, fields: busabaseCommits.fields })
            .from(busabaseCommits)
            .where(inArray(busabaseCommits.id, headCommitIds))
        ).map((commit) => [commit.id, commit.fields])
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
  // Comments thread under the change requests above, so they must already exist.
  await seedCommentsIfMissing(now(), scenario.comments ?? []);
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
