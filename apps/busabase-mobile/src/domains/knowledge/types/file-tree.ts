import type { FileTreeFileVO, FileTreeNodeVO } from "busabase-contract/types";

export interface OpenFile {
  path: string;
  content: string;
  original: string;
  contentHash?: string;
  loading: boolean;
  error: string | null;
}

export interface NewFileDraft {
  path: string;
  content: string;
}

export type FileTreeChangeRequestOperation =
  | {
      kind: "create" | "update";
      path: string;
      content: string;
      baseContentHash?: string;
    }
  | {
      kind: "delete";
      path: string;
      baseContentHash?: string;
    }
  | {
      kind: "metadata_update";
      metadata: {
        entryFile?: string;
        visibility?: "private" | "workspace" | "public";
        version?: string;
      };
    };

export interface FileTreeScreenProps {
  title: string;
  entityLabel: "Drive" | "Skill";
  fileTree: FileTreeNodeVO | null;
  loading: boolean;
  error?: Error | null;
  refreshing?: boolean;
  onRefresh: () => void;
  onReadFile: (filePath: string) => Promise<{
    content: string;
    contentHash: string;
  }>;
  onCreateChangeRequest: (input: {
    message: string;
    submittedBy: string;
    operations: FileTreeChangeRequestOperation[];
  }) => Promise<{ id: string }>;
  onChangeRequestCreated: (changeRequestId: string) => void;
}

export type FileTreeVisibility = FileTreeNodeVO["visibility"];
export type FileEditorMode = "preview" | "edit";

export type FileTreeListItem =
  | (FileTreeFileVO & { type: "file" })
  | {
      path: string;
      name: string;
      type: "folder";
      size: 0;
      updatedAt: null;
      mimeType: null;
      assetId: null;
      displayName: null;
    };

export interface MetadataDraft {
  entryFile: string;
  visibility: FileTreeVisibility;
  version: string;
}
