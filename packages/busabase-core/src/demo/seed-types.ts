import type { DemoUseCase } from "../context";
import type { BaseFieldVO, ChangeRequestStatus, OperationKind, ViewConfigVO } from "../types";

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
  deleteMode?: "archive" | "hard_delete_after_retention";
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

export interface SeedScenario {
  folders?: SeedFolderDef[];
  bases?: SeedBaseDef[];
  records?: SeedRecordDef[];
  views?: SeedViewDef[];
  changeRequests?: SeedChangeRequestDef[];
}
