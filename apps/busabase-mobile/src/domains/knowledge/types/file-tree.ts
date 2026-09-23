import type { BusabaseORPCClient } from "busabase-contract/api-client/react-query";
import type { FileTreeFileVO, FileTreeNodeVO } from "busabase-contract/types";

export type ReadFileResult = Awaited<ReturnType<BusabaseORPCClient["fileTrees"]["readFile"]>>;

export interface OpenFile {
  path: string;
  content: string;
  original: string;
  contentHash?: string;
  loading: boolean;
  error: string | null;
  /**
   * How the server handed the bytes over: `utf8` means `content` IS the file,
   * `url` means the file lives in storage and `content` is empty.
   *
   * Dropping this was how an image ended up in a text editor showing
   * "Empty file." — and how typing in that box could replace the image with
   * whatever was typed. See `utils/file-content-kind`.
   */
  encoding?: string | null;
  mimeType?: string | null;
  /** Where the bytes actually are, when they are not in `content`. */
  assetUrl?: string | null;
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
  /**
   * Typed off the contract rather than re-declared.
   *
   * The local shape used to be `{ content, contentHash }`, which is what hid
   * `encoding` / `mimeType` / `assetUrl` from every reader of this file — the
   * server had been sending them all along. A hand-written subset makes the
   * compiler agree that the missing fields do not exist.
   */
  onReadFile: (filePath: string) => Promise<ReadFileResult>;
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
