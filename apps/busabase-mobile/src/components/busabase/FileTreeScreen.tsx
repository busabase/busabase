import type { FileTreeFileVO, FileTreeNodeVO } from "busabase-contract/types";
import {
  ArrowUp,
  FilePlus2,
  FileText,
  Folder,
  MoreHorizontal,
  Pencil,
  Settings2,
  Trash2,
} from "lucide-react-native";
import { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeChipList,
  NativeEmptyState,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { getAttachmentKindLabel } from "~/lib/attachment";
import { formatBytes } from "~/lib/format";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const SUBMITTED_BY = "mobile-editor";

interface OpenFile {
  path: string;
  content: string;
  original: string;
  contentHash?: string;
  loading: boolean;
  error: string | null;
}

interface NewFileDraft {
  path: string;
  content: string;
}

type FileTreeChangeRequestOperation =
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

interface FileTreeScreenProps {
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

type FileTreeVisibility = FileTreeNodeVO["visibility"];
type FileEditorMode = "preview" | "edit";
type FileTreeListItem =
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

interface MetadataDraft {
  entryFile: string;
  visibility: FileTreeVisibility;
  version: string;
}

const fileKindByExtension: Record<string, string> = {
  css: "CSS",
  env: "Environment",
  js: "JavaScript",
  json: "JSON",
  jsx: "React",
  md: "Markdown",
  mdx: "MDX",
  ts: "TypeScript",
  tsx: "React",
  txt: "Text file",
  yaml: "YAML",
  yml: "YAML",
};

const getExtension = (path: string) => {
  const fileName = path.split("/").filter(Boolean).at(-1) ?? path;
  const extension = fileName.includes(".") ? fileName.split(".").pop() : "";
  return extension?.toLowerCase() ?? "";
};

const getFileKindLabel = (file: FileTreeFileVO) => {
  const extension = getExtension(file.name || file.path);
  return (
    fileKindByExtension[extension] ?? getAttachmentKindLabel({ fileName: file.name || file.path })
  );
};

const formatFileSubtitle = (file: FileTreeFileVO) => {
  const kind = getFileKindLabel(file);
  if (!file.updatedAt) {
    return kind;
  }
  const date = new Date(file.updatedAt);
  if (Number.isNaN(date.getTime())) {
    return kind;
  }
  const updated = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
    date,
  );
  return `${kind} · ${updated}`;
};

const formatItemCount = (count: number) => `${count} item${count === 1 ? "" : "s"}`;

const countLines = (value: string) => (value.length === 0 ? 0 : value.split(/\r\n|\r|\n/).length);

const countCharacters = (value: string) => Array.from(value).length;

const formatCount = (value: number, singular: string, plural = `${singular}s`) =>
  `${value.toLocaleString()} ${value === 1 ? singular : plural}`;

const formatSignedCount = (value: number, singular: string, plural = `${singular}s`) => {
  const label = Math.abs(value) === 1 ? singular : plural;
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString()} ${label}`;
};

const formatTextStats = (value: string) =>
  `${formatCount(countLines(value), "line")} · ${formatCount(countCharacters(value), "character")}`;

const formatTextChangeSummary = (before: string, after: string) => {
  const lineDelta = countLines(after) - countLines(before);
  const characterDelta = countCharacters(after) - countCharacters(before);

  if (lineDelta === 0 && characterDelta === 0) {
    return "No changes";
  }

  return `${formatSignedCount(lineDelta, "line")} · ${formatSignedCount(
    characterDelta,
    "character",
  )}`;
};

const resolveMessage = (message: string, fallback: string) => message.trim() || fallback;

const visibilityOptions: Array<{ value: FileTreeVisibility; label: string }> = [
  { value: "private", label: "Private" },
  { value: "workspace", label: "Workspace" },
  { value: "public", label: "Public" },
];

const getVisibilityLabel = (visibility: FileTreeVisibility) =>
  visibilityOptions.find((option) => option.value === visibility)?.label ?? visibility;

const metadataChanged = (fileTree: FileTreeNodeVO | null, draft: MetadataDraft | null) =>
  !!fileTree &&
  !!draft &&
  (draft.entryFile.trim() !== fileTree.entryFile ||
    draft.version.trim() !== fileTree.version ||
    draft.visibility !== fileTree.visibility);

const getParentPath = (path: string) => {
  const parts = path.split("/");
  if (parts.length <= 1) {
    return "Root";
  }
  return parts.slice(0, -1).join("/");
};

const normalizeFolderPath = (path: string) => path.replace(/^\/+|\/+$/g, "");

const getFolderForFile = (file: FileTreeListItem) => {
  if (file.type === "folder") {
    return normalizeFolderPath(file.path);
  }
  return getParentPath(file.path) === "Root" ? "" : normalizeFolderPath(getParentPath(file.path));
};

const getDisplayName = (file: FileTreeListItem, currentFolder: string) => {
  const prefix = currentFolder ? `${currentFolder}/` : "";
  const relativePath = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path;
  return file.name || relativePath.split("/").filter(Boolean).at(-1) || file.path;
};

const getParentFolder = (folderPath: string) => {
  const parts = normalizeFolderPath(folderPath).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
};

const getFolderItemCount = (files: FileTreeListItem[], folderPath: string) =>
  files.filter((file) => getFolderForFile(file) === normalizeFolderPath(folderPath)).length;

const sortFilesForMobile = (files: FileTreeListItem[], currentFolder: string) =>
  [...files].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "folder" ? -1 : 1;
    }
    return getDisplayName(left, currentFolder).localeCompare(
      getDisplayName(right, currentFolder),
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      },
    );
  });

const buildFileTreeListItems = (files: FileTreeFileVO[]): FileTreeListItem[] => {
  const folders = new Map<string, FileTreeListItem>();
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    for (let index = 1; index < parts.length; index++) {
      const folderPath = parts.slice(0, index).join("/");
      if (!folders.has(folderPath)) {
        folders.set(folderPath, {
          path: folderPath,
          name: parts[index - 1] ?? folderPath,
          type: "folder",
          size: 0,
          updatedAt: null,
          mimeType: null,
          assetId: null,
          displayName: null,
        });
      }
    }
  }
  return [
    ...folders.values(),
    ...files.map((file) => ({
      ...file,
      type: "file" as const,
    })),
  ];
};

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
  const fileCount = files.length;
  const folderCount = fileItems.length - fileCount;
  const itemSummary = `${formatCount(fileCount, "file")} · ${formatCount(folderCount, "folder")}`;
  const visibleFiles = sortFilesForMobile(
    fileItems.filter((file) => getFolderForFile(file) === currentFolder),
    currentFolder,
  );
  const currentFolderLabel = currentFolder || "Root";
  const editorSheetVisible =
    (!!openFile || !!newFile) && !fileActionsOpen && !deleteConfirmOpen && !discardEditorOpen;
  const metadataSheetVisible = !!metadataDraft && !discardMetadataOpen;
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
    setOpenFile({
      path: file.path,
      content: "",
      original: "",
      loading: true,
      error: null,
    });
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
      {
        kind: "create",
        path,
        content: newFile.content,
      },
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

  return (
    <DrawerScaffold
      title={fileTree?.node.name ?? title}
      subtitle={fileTree ? `${itemSummary} · ${currentFolderLabel}` : entityLabel}
      refreshing={refreshing}
      onRefresh={onRefresh}
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
        <NativeEmptyState
          title={`${entityLabel} not found`}
          description={`This ${entityLabel.toLowerCase()} is not available.`}
        />
      ) : null}

      {fileTree ? (
        <>
          <NativeSection title="Overview" caption={getVisibilityLabel(fileTree.visibility)}>
            <View style={[styles.overviewIntro, { borderColor: tokens.border }]}>
              <View style={styles.overviewTitleBlock}>
                <Text numberOfLines={1} style={[typography.bodyEm, { color: tokens.foreground }]}>
                  {fileTree.node.name}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[typography.small, { color: tokens.mutedForeground }]}
                >
                  {fileTree.node.description || `${entityLabel} file tree`}
                </Text>
              </View>
              <View style={[styles.visibilityPill, { backgroundColor: tokens.muted }]}>
                <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                  {getVisibilityLabel(fileTree.visibility)}
                </Text>
              </View>
            </View>
            <View style={[styles.statsStrip, { borderColor: tokens.border }]}>
              <View style={styles.statItem}>
                <Text style={[typography.caption, { color: tokens.mutedForeground }]}>Files</Text>
                <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
                  {fileCount.toLocaleString()}
                </Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[typography.caption, { color: tokens.mutedForeground }]}>Folders</Text>
                <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
                  {folderCount.toLocaleString()}
                </Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[typography.caption, { color: tokens.mutedForeground }]}>Version</Text>
                <Text
                  numberOfLines={1}
                  style={[typography.bodyEm, styles.statValue, { color: tokens.foreground }]}
                >
                  {fileTree.version ? `v${fileTree.version}` : "Draft"}
                </Text>
              </View>
            </View>
            <NativeRow title="Entry file" subtitle={fileTree.entryFile || "Not set"} />
            <NativeRow
              title="Edit settings"
              subtitle="Create a change request for visibility, version, or entry file."
              leading={<Settings2 size={18} color={tokens.mutedForeground} />}
              last
              onPress={startMetadataEdit}
            />
          </NativeSection>

          <NativeSection title="Files" caption={currentFolderLabel}>
            <NativeRow
              title={currentFolder ? currentFolderLabel : "Current folder"}
              subtitle={
                currentFolder
                  ? `Back to ${getParentFolder(currentFolder) || "Root"}`
                  : `Root · ${formatItemCount(visibleFiles.length)}`
              }
              leading={
                currentFolder ? (
                  <ArrowUp size={18} color={tokens.mutedForeground} />
                ) : (
                  <Folder size={18} color={tokens.mutedForeground} />
                )
              }
              onPress={
                currentFolder ? () => setCurrentFolder(getParentFolder(currentFolder)) : undefined
              }
              last={visibleFiles.length === 0}
            />
            {visibleFiles.length === 0 ? (
              <NativeRow
                title={files.length === 0 ? "No files" : "Empty folder"}
                subtitle={
                  files.length === 0
                    ? `This ${entityLabel.toLowerCase()} has no files yet.`
                    : "No files in this folder."
                }
                leading={<FileText size={18} color={tokens.mutedForeground} />}
                last
              />
            ) : (
              visibleFiles.map((file, index) => {
                const isFile = file.type === "file";
                const Icon = isFile ? FileText : Folder;
                const last = index === visibleFiles.length - 1;
                const folderItemCount = isFile ? 0 : getFolderItemCount(fileItems, file.path);
                return (
                  <NativeRow
                    key={file.path}
                    title={getDisplayName(file, currentFolder)}
                    subtitle={isFile ? formatFileSubtitle(file) : formatItemCount(folderItemCount)}
                    meta={isFile ? formatBytes(file.size) : undefined}
                    leading={<Icon size={18} color={tokens.mutedForeground} />}
                    last={last}
                    onPress={
                      isFile
                        ? () => void openFileForPreview(file)
                        : () => setCurrentFolder(normalizeFolderPath(file.path))
                    }
                  />
                );
              })
            )}
          </NativeSection>

          {actionError ? (
            <View style={styles.errorWrap}>
              <NativeInlineError message={actionError} onReset={() => setActionError(null)} />
            </View>
          ) : null}
        </>
      ) : null}

      <NativeBottomSheet
        visible={editorSheetVisible}
        title={newFile ? "New file" : openFile?.path}
        description={fileEditorSummary}
        maxHeight="86%"
        showCloseButton
        onClose={closeEditor}
        footer={
          !openFile?.loading && !openFile?.error ? (
            <NativeActionBar>
              {actionError ? (
                <NativeInlineError message={actionError} onReset={() => setActionError(null)} />
              ) : null}
              {newFile ? (
                <Button
                  label="Create change request"
                  loading={saving}
                  disabled={saving || newFile.path.trim().length === 0}
                  fullWidth
                  onPress={submitNewFile}
                />
              ) : fileEditorMode === "edit" ? (
                <>
                  <Button
                    label="Save as CR"
                    loading={saving}
                    disabled={saving || openFile?.content === openFile?.original}
                    fullWidth
                    onPress={submitOpenFile}
                  />
                  <Button
                    label="File actions"
                    variant="ghost"
                    disabled={saving || !openFile || openFile.loading}
                    fullWidth
                    leadingIcon={<MoreHorizontal size={18} color={tokens.foreground} />}
                    onPress={() => setFileActionsOpen(true)}
                  />
                </>
              ) : (
                <>
                  <Button
                    label="Edit file"
                    variant="secondary"
                    disabled={saving || !openFile || openFile.loading}
                    fullWidth
                    leadingIcon={<Pencil size={18} color={tokens.foreground} />}
                    onPress={() => setFileEditorMode("edit")}
                  />
                  <Button
                    label="File actions"
                    variant="ghost"
                    disabled={saving || !openFile || openFile.loading}
                    fullWidth
                    leadingIcon={<MoreHorizontal size={18} color={tokens.foreground} />}
                    onPress={() => setFileActionsOpen(true)}
                  />
                </>
              )}
            </NativeActionBar>
          ) : undefined
        }
      >
        {openFile?.loading ? (
          <NativeLoadingState label="Reading file" />
        ) : openFile?.error ? (
          <NativeErrorState message={openFile.error} />
        ) : openFile && fileEditorMode === "preview" && !newFile ? (
          <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
            <View style={[styles.previewBody, { backgroundColor: tokens.muted }]}>
              <Text selectable style={[typography.body, styles.code, { color: tokens.foreground }]}>
                {openFile.content || "Empty file."}
              </Text>
            </View>
          </ScrollView>
        ) : (
          <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
            {newFile ? (
              <TextInput
                label="Path"
                value={newFile.path}
                placeholder="docs/example.md"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(path) =>
                  setNewFile((current) => (current ? { ...current, path } : current))
                }
              />
            ) : null}
            <TextInput
              label="Change request message"
              value={fileChangeMessage}
              placeholder={fileEditorMessagePlaceholder}
              onChangeText={setFileChangeMessage}
            />
            <TextInput
              label="Content"
              value={newFile ? newFile.content : (openFile?.content ?? "")}
              multiline
              textAlignVertical="top"
              style={[styles.code, styles.editor]}
              onChangeText={(content) => {
                if (newFile) {
                  setNewFile((current) => (current ? { ...current, content } : current));
                } else {
                  setOpenFile((current) => (current ? { ...current, content } : current));
                }
              }}
            />
          </ScrollView>
        )}
      </NativeBottomSheet>

      <NativeBottomSheet
        visible={fileActionsOpen}
        title="File actions"
        description={openFile?.path}
        showCloseButton
        onClose={() => setFileActionsOpen(false)}
        footer={
          <NativeActionBar>
            <Button
              label="Propose delete"
              variant="destructive"
              disabled={saving || !openFile || openFile.loading}
              fullWidth
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              onPress={() => {
                setActionError(null);
                setDeleteChangeMessage("");
                setFileActionsOpen(false);
                setDeleteConfirmOpen(true);
              }}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={saving}
              fullWidth
              onPress={() => setFileActionsOpen(false)}
            />
          </NativeActionBar>
        }
      />

      <NativeBottomSheet
        visible={discardEditorOpen}
        title="Discard changes?"
        description="This closes the file editor and removes the unsaved content and message."
        showCloseButton
        onClose={() => setDiscardEditorOpen(false)}
        footer={
          <NativeActionBar>
            <Button
              label="Discard changes"
              variant="destructive"
              disabled={saving}
              fullWidth
              onPress={discardEditorChanges}
            />
            <Button
              label="Keep editing"
              variant="ghost"
              disabled={saving}
              fullWidth
              onPress={() => setDiscardEditorOpen(false)}
            />
          </NativeActionBar>
        }
      />

      <NativeBottomSheet
        visible={deleteConfirmOpen}
        title="Delete file?"
        description={
          openFile
            ? `Create a delete change request for ${openFile.path}. The file changes only after review and merge.`
            : undefined
        }
        showCloseButton
        onClose={() => {
          setDeleteConfirmOpen(false);
          setDeleteChangeMessage("");
        }}
        footer={
          <NativeActionBar>
            {actionError ? (
              <NativeInlineError message={actionError} onReset={() => setActionError(null)} />
            ) : null}
            <Button
              label="Create delete change request"
              variant="destructive"
              loading={saving}
              disabled={!openFile || openFile.loading}
              fullWidth
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              onPress={submitDeleteOpenFile}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={saving}
              fullWidth
              onPress={() => {
                setDeleteConfirmOpen(false);
                setDeleteChangeMessage("");
              }}
            />
          </NativeActionBar>
        }
      >
        {openFile ? (
          <View style={styles.sheetBody}>
            <TextInput
              label="Change request message"
              value={deleteChangeMessage}
              placeholder={`Delete ${openFile.path}`}
              onChangeText={setDeleteChangeMessage}
            />
          </View>
        ) : null}
      </NativeBottomSheet>

      <NativeBottomSheet
        visible={metadataSheetVisible}
        title={`${entityLabel} settings`}
        description="Create a change request for file tree metadata. Changes apply after review and merge."
        maxHeight="78%"
        showCloseButton
        onClose={closeMetadataEditor}
        footer={
          <NativeActionBar>
            {actionError ? (
              <NativeInlineError message={actionError} onReset={() => setActionError(null)} />
            ) : null}
            <Button
              label="Create settings change request"
              loading={saving}
              disabled={saving || !canSubmitMetadata}
              fullWidth
              leadingIcon={<Settings2 size={18} color={tokens.primaryForeground} />}
              onPress={submitMetadataUpdate}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={saving}
              fullWidth
              onPress={closeMetadataEditor}
            />
          </NativeActionBar>
        }
      >
        {metadataDraft ? (
          <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
            <TextInput
              label="Change request message"
              value={metadataChangeMessage}
              placeholder={metadataMessagePlaceholder}
              onChangeText={setMetadataChangeMessage}
            />
            <Text style={[typography.caption, { color: tokens.mutedForeground }]}>Visibility</Text>
            <NativeChipList<FileTreeVisibility>
              value={metadataDraft.visibility}
              options={visibilityOptions}
              onChange={(visibility) =>
                setMetadataDraft((current) => (current ? { ...current, visibility } : current))
              }
            />
            <TextInput
              label="Version"
              value={metadataDraft.version}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="0.1.0"
              onChangeText={(version) =>
                setMetadataDraft((current) => (current ? { ...current, version } : current))
              }
            />
            <TextInput
              label="Entry file"
              value={metadataDraft.entryFile}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="README.md"
              onChangeText={(entryFile) =>
                setMetadataDraft((current) => (current ? { ...current, entryFile } : current))
              }
            />
          </ScrollView>
        ) : null}
      </NativeBottomSheet>

      <NativeBottomSheet
        visible={discardMetadataOpen}
        title="Discard settings changes?"
        description={`This closes the ${entityLabel.toLowerCase()} settings editor and removes the unsaved metadata and message.`}
        showCloseButton
        onClose={() => setDiscardMetadataOpen(false)}
        footer={
          <NativeActionBar>
            <Button
              label="Discard changes"
              variant="destructive"
              fullWidth
              onPress={discardMetadataChanges}
            />
            <Button
              label="Keep editing"
              variant="ghost"
              fullWidth
              onPress={() => setDiscardMetadataOpen(false)}
            />
          </NativeActionBar>
        }
      />
    </DrawerScaffold>
  );
}

const styles = StyleSheet.create({
  errorWrap: { marginHorizontal: 20, marginTop: 12 },
  overviewIntro: {
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  overviewTitleBlock: { flex: 1, minWidth: 0, gap: 3 },
  visibilityPill: {
    borderRadius: radius.full,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statsStrip: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: "row",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statItem: { flex: 1, minWidth: 0, gap: 2 },
  statValue: { minWidth: 0 },
  modalBody: { marginHorizontal: -2 },
  modalBodyContent: { paddingBottom: 12, gap: 12 },
  previewBody: {
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  sheetBody: { paddingTop: 4 },
  code: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 13,
    lineHeight: 19,
  },
  editor: { minHeight: 240, paddingTop: 12 },
});
