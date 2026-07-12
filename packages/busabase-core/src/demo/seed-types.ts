import type {
  BaseFieldVO,
  ChangeRequestStatus,
  OperationKind,
  ViewConfigVO,
} from "busabase-contract/types";
import type { DemoUseCase } from "../context";

export type SeedFieldDef = Omit<BaseFieldVO, "baseId" | "position">;

export interface SeedFolderDef {
  nodeId: string;
  slug: string;
  name: string;
  description: string;
  position: number;
}

export interface SeedBaseDef {
  id: string;
  nodeId: string;
  slug: string;
  name: string;
  description: string;
  /** Sidebar folder this base lives under (a `DEMO_FOLDERS` node id). */
  folderNodeId: string;
  useCases: DemoUseCase[];
  fields: SeedFieldDef[];
}

export interface SeedRecordDef {
  id: string;
  baseId: string;
  commitId: string;
  fields: Record<string, unknown>;
  message: string;
  author: string;
  /** Minutes before the dataset "now" anchor that this record was created. */
  minutesAgo: number;
  /**
   * Field slug for a `created_time` system field whose value is the record's own
   * creation timestamp; injected at build time so it stays in sync with
   * `minutesAgo` (and is identical in the real seed and the demo).
   */
  createdTimeSlug?: string;
  useCases: DemoUseCase[];
}

export interface SeedOperationDef {
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
  /** Resolved "before" values shown in the diff (record_update/delete). */
  baseFields?: Record<string, unknown> | null;
}

export interface SeedChangeRequestDef {
  id: string;
  baseId: string;
  status: ChangeRequestStatus;
  submittedBy: string;
  sourceMeta: Record<string, unknown>;
  minutesAgo: number;
  reviewedMinutesAgo?: number | null;
  useCases: DemoUseCase[];
  operations: SeedOperationDef[];
}

export interface SeedViewDef {
  id: string;
  baseId: string;
  slug: string;
  name: string;
  description: string;
  config: ViewConfigVO;
  minutesAgo: number;
  useCases: DemoUseCase[];
}

export interface SeedDocDef {
  nodeId: string;
  slug: string;
  name: string;
  description: string;
  /** Markdown body written to storage. */
  body: string;
  position: number;
  /** Optional in-review `doc_update` change request, to demo the Doc review flow. */
  changeRequest?: {
    id: string;
    operationId: string;
    commitId: string;
    submittedBy: string;
    minutesAgo: number;
    message: string;
    /** Proposed body carried by the change request. */
    nextBody: string;
  };
}

export interface SeedFileDef {
  nodeId: string;
  slug: string;
  name: string;
  description: string;
  fileName: string;
  mimeType: string;
  /** File bytes (text content) written to storage. */
  body: string;
  attachmentId: string;
  assetId: string;
  storageKey: string;
  position: number;
}

export interface SeedFileTreeChangeRequestDef {
  id: string;
  operationId: string;
  commitId: string;
  submittedBy: string;
  /** Minutes before the dataset "now" anchor that this change request was submitted. */
  minutesAgo: number;
  /**
   * Path (within the def's `files`) whose current content becomes the change
   * request's base-content hash, and whose proposed replacement is `nextContent`.
   */
  filePath: string;
  /** Proposed replacement content for `filePath`. */
  nextContent: string;
  message: string;
  /** `sourceMeta.scenario` — a short label for what workflow this demos. */
  scenario: string;
  /** `sourceMeta.workflow` — a short label for the review workflow being demoed. */
  workflow: string;
}

/**
 * A Skill, Drive, or AirApp node — all three are file-tree nodes that share
 * the exact same shape (a folder-scoped node with files written through
 * `writeFileTreeTextFile`), so one generic definition covers all of them
 * instead of three copy-pasted per-kind interfaces.
 */
export interface SeedFileTreeDef {
  nodeType: "skill" | "drive" | "airapp";
  nodeId: string;
  slug: string;
  name: string;
  description: string;
  files: { path: string; content: string }[];
  position: number;
  /** Optional in-review file-update change request, to demo the node's review flow. */
  changeRequest?: SeedFileTreeChangeRequestDef;
}

export interface SeedCommentDef {
  id: string;
  subjectType: "record" | "change_request" | "operation" | "commit";
  /** A record id or change-request id that this scenario also seeds. */
  subjectId: string;
  authorId: string;
  body: string;
  mentionsAi?: boolean;
  /** Minutes before the dataset "now" anchor that this comment was posted. */
  minutesAgo: number;
}

export interface SeedScenario {
  folders?: SeedFolderDef[];
  bases?: SeedBaseDef[];
  records?: SeedRecordDef[];
  views?: SeedViewDef[];
  changeRequests?: SeedChangeRequestDef[];
  /** First-class Doc nodes (long-form Markdown edited through review). */
  docs?: SeedDocDef[];
  /** First-class File nodes, each backed by an Asset. */
  files?: SeedFileDef[];
  /** Skill / Drive / AirApp nodes — all file-tree nodes, see `SeedFileTreeDef`. */
  fileTreeNodes?: SeedFileTreeDef[];
  /** Review discussion threaded under the scenario's change requests / records. */
  comments?: SeedCommentDef[];
}
