import { useState } from "react";
import type {
  FileEditorMode,
  FileTreeChangeRequestOperation,
  FileTreeListItem,
  FileTreeScreenProps,
  MetadataDraft,
  NewFileDraft,
  OpenFile,
} from "../types/file-tree";
import {
  buildFileTreeListItems,
  formatCount,
  formatTextChangeSummary,
  formatTextStats,
  getFolderForFile,
  metadataChanged,
  normalizeFolderPath,
  resolveMessage,
  sortFilesForMobile,
} from "../utils/file-tree";

const SUBMITTED_BY = "mobile-editor";

type UseFileTreeControllerOptions = Pick<
  FileTreeScreenProps,
  "entityLabel" | "fileTree" | "onReadFile" | "onCreateChangeRequest" | "onChangeRequestCreated"
>;

export const useFileTreeController = ({
  entityLabel,
  fileTree,
  onReadFile,
  onCreateChangeRequest,
  onChangeRequestCreated,
}: UseFileTreeControllerOptions) => {
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [newFile, setNewFile] = useState<NewFileDraft | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [currentFolder, setCurrentFolder] = useState("");
  const [fileEditorMode, setFileEditorMode] = useState<FileEditorMode>("preview");
  const [fileActionsOpen, setFileActionsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [discardEditorOpen, setDiscardEditorOpen] = useState(false);
  const [discardMetadataOpen, setDiscardMetadataOpen] = useState(false);
  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft | null>(null);
  const [fileChangeMessage, setFileChangeMessage] = useState("");
  const [deleteChangeMessage, setDeleteChangeMessage] = useState("");
  const [metadataChangeMessage, setMetadataChangeMessage] = useState("");

  const files = fileTree?.files ?? [];
  const fileItems = buildFileTreeListItems(files);
  const folderCount = fileItems.length - files.length;
  const itemSummary = `${formatCount(files.length, "file")} · ${formatCount(folderCount, "folder")}`;
  const visibleFiles = sortFilesForMobile(
    fileItems.filter((file) => getFolderForFile(file) === currentFolder),
    currentFolder,
  );
  const defaultNewFilePath = currentFolder ? `${currentFolder}/` : "";
  const editorHasUnsavedChanges =
    (!!newFile && (newFile.path !== defaultNewFilePath || newFile.content.length > 0)) ||
    !!fileChangeMessage.trim() ||
    (!!openFile && !openFile.loading && !openFile.error && openFile.content !== openFile.original);
  const canSubmitMetadata = metadataChanged(fileTree, metadataDraft);
  const fileEditorMessagePlaceholder = newFile
    ? `Create ${newFile.path.trim() || "file"}`
    : openFile
      ? `Update ${openFile.path}`
      : `Update ${entityLabel.toLowerCase()} files`;
  const fileEditorSummary = newFile
    ? formatTextStats(newFile.content)
    : openFile && !openFile.loading && !openFile.error
      ? fileEditorMode === "edit"
        ? formatTextChangeSummary(openFile.original, openFile.content)
        : formatTextStats(openFile.content)
      : undefined;
  const metadataMessagePlaceholder = `Update ${entityLabel.toLowerCase()} settings`;

  const openFileForPreview = async (file: FileTreeListItem) => {
    if (file.type !== "file") {
      return;
    }
    setActionError(null);
    setFileChangeMessage("");
    setFileEditorMode("preview");
    setOpenFile({ path: file.path, content: "", original: "", loading: true, error: null });
    try {
      const result = await onReadFile(file.path);
      setOpenFile({
        path: file.path,
        content: result.content,
        original: result.content,
        contentHash: result.contentHash,
        loading: false,
        error: null,
      });
    } catch (readError) {
      setOpenFile({
        path: file.path,
        content: "",
        original: "",
        loading: false,
        error: readError instanceof Error ? readError.message : "Could not read file",
      });
    }
  };

  const submitOperations = async (
    message: string,
    operations: FileTreeChangeRequestOperation[],
  ) => {
    if (saving) {
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const changeRequest = await onCreateChangeRequest({
        message,
        submittedBy: SUBMITTED_BY,
        operations,
      });
      setOpenFile(null);
      setNewFile(null);
      setDeleteConfirmOpen(false);
      setDiscardEditorOpen(false);
      setDiscardMetadataOpen(false);
      setMetadataDraft(null);
      setFileChangeMessage("");
      setDeleteChangeMessage("");
      setMetadataChangeMessage("");
      setFileEditorMode("preview");
      onChangeRequestCreated(changeRequest.id);
    } catch (mutationError) {
      setActionError(mutationError instanceof Error ? mutationError.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const submitOpenFile = () => {
    if (!openFile || openFile.content === openFile.original) {
      return;
    }
    void submitOperations(resolveMessage(fileChangeMessage, `Update ${openFile.path}`), [
      {
        kind: "update",
        path: openFile.path,
        content: openFile.content,
        baseContentHash: openFile.contentHash,
      },
    ]);
  };

  const closeEditor = () => {
    if (saving) {
      return;
    }
    if (editorHasUnsavedChanges) {
      setDiscardEditorOpen(true);
      return;
    }
    setOpenFile(null);
    setNewFile(null);
    setDeleteConfirmOpen(false);
    setFileChangeMessage("");
    setFileEditorMode("preview");
  };

  const discardEditorChanges = () => {
    if (saving) {
      return;
    }
    setOpenFile(null);
    setNewFile(null);
    setDeleteConfirmOpen(false);
    setDiscardEditorOpen(false);
    setFileChangeMessage("");
    setActionError(null);
    setFileEditorMode("preview");
  };

  const closeMetadataEditor = () => {
    if (saving) {
      return;
    }
    if (canSubmitMetadata || metadataChangeMessage.trim()) {
      setDiscardMetadataOpen(true);
      return;
    }
    setMetadataDraft(null);
    setMetadataChangeMessage("");
  };

  const discardMetadataChanges = () => {
    if (saving) {
      return;
    }
    setMetadataDraft(null);
    setDiscardMetadataOpen(false);
    setMetadataChangeMessage("");
    setActionError(null);
  };

  const submitNewFile = () => {
    const path = newFile?.path.trim();
    if (!newFile || !path) {
      return;
    }
    void submitOperations(resolveMessage(fileChangeMessage, `Create ${path}`), [
      { kind: "create", path, content: newFile.content },
    ]);
  };

  const submitDeleteOpenFile = () => {
    if (!openFile || openFile.loading) {
      return;
    }
    void submitOperations(resolveMessage(deleteChangeMessage, `Delete ${openFile.path}`), [
      { kind: "delete", path: openFile.path, baseContentHash: openFile.contentHash },
    ]);
  };

  const startNewFile = () => {
    setActionError(null);
    setFileChangeMessage("");
    setFileEditorMode("edit");
    setNewFile({ path: defaultNewFilePath, content: "" });
  };

  const startMetadataEdit = () => {
    if (!fileTree) {
      return;
    }
    setActionError(null);
    setMetadataChangeMessage("");
    setMetadataDraft({
      entryFile: fileTree.entryFile,
      visibility: fileTree.visibility,
      version: fileTree.version,
    });
  };

  const submitMetadataUpdate = () => {
    if (!fileTree || !metadataDraft || !metadataChanged(fileTree, metadataDraft)) {
      return;
    }
    void submitOperations(resolveMessage(metadataChangeMessage, metadataMessagePlaceholder), [
      {
        kind: "metadata_update",
        metadata: {
          entryFile: metadataDraft.entryFile.trim() || undefined,
          visibility: metadataDraft.visibility,
          version: metadataDraft.version.trim() || undefined,
        },
      },
    ]);
  };

  const closeDeleteConfirmation = () => {
    setDeleteConfirmOpen(false);
    setDeleteChangeMessage("");
  };

  const changeFileContent = (content: string) => {
    if (newFile) {
      setNewFile((current) => (current ? { ...current, content } : current));
    } else {
      setOpenFile((current) => (current ? { ...current, content } : current));
    }
  };

  return {
    actionError,
    canSubmitMetadata,
    clearActionError: () => setActionError(null),
    closeDeleteConfirmation,
    closeEditor,
    closeFileActions: () => setFileActionsOpen(false),
    closeMetadataEditor,
    currentFolder,
    deleteChangeMessage,
    deleteConfirmOpen,
    discardEditorChanges,
    discardEditorOpen,
    discardMetadataChanges,
    discardMetadataOpen,
    fileActionsOpen,
    fileChangeMessage,
    fileEditorMessagePlaceholder,
    fileEditorMode,
    fileEditorSummary,
    fileItems,
    files,
    itemSummary,
    metadataChangeMessage,
    metadataDraft,
    metadataMessagePlaceholder,
    newFile,
    openFile,
    openFileActions: () => setFileActionsOpen(true),
    openFileForPreview,
    openFolder: (path: string) => setCurrentFolder(normalizeFolderPath(path)),
    proposeDelete: () => {
      setActionError(null);
      setDeleteChangeMessage("");
      setFileActionsOpen(false);
      setDeleteConfirmOpen(true);
    },
    saving,
    setDeleteChangeMessage,
    setDiscardEditorOpen,
    setDiscardMetadataOpen,
    setFileChangeMessage,
    setMetadataChangeMessage,
    startEditingFile: () => setFileEditorMode("edit"),
    startMetadataEdit,
    startNewFile,
    submitDeleteOpenFile,
    submitMetadataUpdate,
    submitNewFile,
    submitOpenFile,
    updateFileContent: changeFileContent,
    updateNewFilePath: (path: string) =>
      setNewFile((current) => (current ? { ...current, path } : current)),
    updateMetadataEntryFile: (entryFile: string) =>
      setMetadataDraft((current) => (current ? { ...current, entryFile } : current)),
    updateMetadataVersion: (version: string) =>
      setMetadataDraft((current) => (current ? { ...current, version } : current)),
    updateMetadataVisibility: (visibility: MetadataDraft["visibility"]) =>
      setMetadataDraft((current) => (current ? { ...current, visibility } : current)),
    visibleFiles,
  };
};
