import { FilePlus2, Settings2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  NativeActionBar,
  NativeEmptyState,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
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
  getVisibilityLabel,
  metadataChanged,
  normalizeFolderPath,
  resolveMessage,
  sortFilesForMobile,
} from "../utils/file-tree";
import { FileActionSheets } from "./FileActionSheets";
import { FileEditorSheet } from "./FileEditorSheet";
import { FileTreeList } from "./FileTreeList";
import { FileTreeMetadataSheets } from "./FileTreeMetadataSheets";

const SUBMITTED_BY = "mobile-editor";

export function FileTreeScreen({
  title,
  entityLabel,
  fileTree,
  loading,
  error,
  refreshing,
  onRefresh,
  onReadFile,
  onCreateChangeRequest,
  onChangeRequestCreated,
}: FileTreeScreenProps) {
  const tokens = useTokens();
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

  return (
    <DrawerScaffold
      title={fileTree?.node.name ?? title}
      titleNumberOfLines={2}
      subtitle={
        fileTree ? `${itemSummary} · ${getVisibilityLabel(fileTree.visibility)}` : entityLabel
      }
      refreshing={refreshing}
      onRefresh={onRefresh}
      headerAction={
        fileTree ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${entityLabel.toLowerCase()} settings`}
            hitSlop={mobile.hitSlop}
            style={[styles.settingsButton, { backgroundColor: tokens.primaryMuted }]}
            onPress={startMetadataEdit}
          >
            <Settings2 size={20} color={tokens.foreground} />
          </Pressable>
        ) : undefined
      }
      footer={
        fileTree ? (
          <NativeActionBar>
            <Button
              label="New file"
              variant="secondary"
              leadingIcon={<FilePlus2 size={18} color={tokens.foreground} />}
              fullWidth
              onPress={startNewFile}
            />
          </NativeActionBar>
        ) : undefined
      }
    >
      {loading ? <NativeLoadingState label={`Loading ${entityLabel.toLowerCase()}`} /> : null}
      {error ? <NativeErrorState message={error.message} onRetry={onRefresh} /> : null}
      {!loading && !error && !fileTree ? (
        <NativeEmptyState title={`${entityLabel} not found`} />
      ) : null}

      {fileTree ? (
        <>
          <FileTreeList
            currentFolder={currentFolder}
            fileItems={fileItems}
            totalFileCount={files.length}
            visibleFiles={visibleFiles}
            onOpenFile={(file) => void openFileForPreview(file)}
            onOpenFolder={(path) => setCurrentFolder(normalizeFolderPath(path))}
          />
          {actionError ? (
            <View style={styles.errorWrap}>
              <NativeInlineError message={actionError} onReset={() => setActionError(null)} />
            </View>
          ) : null}
        </>
      ) : null}

      <FileEditorSheet
        visible={
          (!!openFile || !!newFile) && !fileActionsOpen && !deleteConfirmOpen && !discardEditorOpen
        }
        openFile={openFile}
        newFile={newFile}
        mode={fileEditorMode}
        saving={saving}
        actionError={actionError}
        message={fileChangeMessage}
        messagePlaceholder={fileEditorMessagePlaceholder}
        summary={fileEditorSummary}
        onClose={closeEditor}
        onClearError={() => setActionError(null)}
        onMessageChange={setFileChangeMessage}
        onPathChange={(path) => setNewFile((current) => (current ? { ...current, path } : current))}
        onContentChange={(content) => {
          if (newFile) {
            setNewFile((current) => (current ? { ...current, content } : current));
          } else {
            setOpenFile((current) => (current ? { ...current, content } : current));
          }
        }}
        onCreate={submitNewFile}
        onSave={submitOpenFile}
        onEdit={() => setFileEditorMode("edit")}
        onOpenActions={() => setFileActionsOpen(true)}
      />

      <FileActionSheets
        openFile={openFile}
        saving={saving}
        actionError={actionError}
        actionsVisible={fileActionsOpen}
        discardVisible={discardEditorOpen}
        deleteVisible={deleteConfirmOpen}
        deleteMessage={deleteChangeMessage}
        onClearError={() => setActionError(null)}
        onCloseActions={() => setFileActionsOpen(false)}
        onProposeDelete={() => {
          setActionError(null);
          setDeleteChangeMessage("");
          setFileActionsOpen(false);
          setDeleteConfirmOpen(true);
        }}
        onCloseDiscard={() => setDiscardEditorOpen(false)}
        onDiscard={discardEditorChanges}
        onCloseDelete={closeDeleteConfirmation}
        onDeleteMessageChange={setDeleteChangeMessage}
        onSubmitDelete={submitDeleteOpenFile}
      />

      <FileTreeMetadataSheets
        entityLabel={entityLabel}
        draft={metadataDraft}
        saving={saving}
        canSubmit={canSubmitMetadata}
        actionError={actionError}
        message={metadataChangeMessage}
        messagePlaceholder={metadataMessagePlaceholder}
        discardVisible={discardMetadataOpen}
        onClose={closeMetadataEditor}
        onClearError={() => setActionError(null)}
        onMessageChange={setMetadataChangeMessage}
        onVisibilityChange={(visibility) =>
          setMetadataDraft((current) => (current ? { ...current, visibility } : current))
        }
        onVersionChange={(version) =>
          setMetadataDraft((current) => (current ? { ...current, version } : current))
        }
        onEntryFileChange={(entryFile) =>
          setMetadataDraft((current) => (current ? { ...current, entryFile } : current))
        }
        onSubmit={submitMetadataUpdate}
        onCloseDiscard={() => setDiscardMetadataOpen(false)}
        onDiscard={discardMetadataChanges}
      />
    </DrawerScaffold>
  );
}

const styles = StyleSheet.create({
  errorWrap: { marginHorizontal: 20, marginTop: 12 },
  settingsButton: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
