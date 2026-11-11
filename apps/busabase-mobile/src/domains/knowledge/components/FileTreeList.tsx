import { ArrowUp, FileText, Folder, MoreHorizontal } from "lucide-react-native";
import { Pressable, type ViewStyle } from "react-native";
import { NativeRow, NativeSection } from "~/components/native-screen";
import { fmt, useI18n } from "~/i18n";
import { formatBytes } from "~/lib/format";
import { mobile } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { FileTreeListItem } from "../types/file-tree";
import {
  formatFileSubtitle,
  getDisplayName,
  getFolderItemCount,
  getParentFolder,
} from "../utils/file-tree";

interface FileTreeListProps {
  currentFolder: string;
  fileItems: FileTreeListItem[];
  totalFileCount: number;
  visibleFiles: FileTreeListItem[];
  onOpenFile: (file: FileTreeListItem) => void;
  onOpenFolder: (path: string) => void;
  /** Adds a "•••" button to each folder row (the `drive` field's rename/move/remove). */
  onFolderActions?: (path: string) => void;
  /** Overrides the section's screen-edge margins, e.g. when listed inside a form row. */
  style?: ViewStyle;
}

export function FileTreeList({
  currentFolder,
  fileItems,
  totalFileCount,
  visibleFiles,
  onOpenFile,
  onOpenFolder,
  onFolderActions,
  style,
}: FileTreeListProps) {
  const tokens = useTokens();
  const { t } = useI18n();
  const itemCount = (count: number) =>
    count === 1 ? t.fileTree.itemCountOne : fmt(t.fileTree.itemCount, { count });

  return (
    <NativeSection
      title={currentFolder || t.fileTree.root}
      caption={itemCount(visibleFiles.length)}
      style={style}
    >
      {currentFolder ? (
        <NativeRow
          title={getParentFolder(currentFolder) || t.fileTree.root}
          leading={<ArrowUp size={18} color={tokens.mutedForeground} />}
          onPress={() => onOpenFolder(getParentFolder(currentFolder))}
        />
      ) : null}
      {visibleFiles.length === 0 ? (
        <NativeRow
          title={totalFileCount === 0 ? t.fileTree.noFiles : t.fileTree.emptyFolder}
          leading={<FileText size={18} color={tokens.mutedForeground} />}
          last
        />
      ) : (
        visibleFiles.map((file, index) => {
          const isFile = file.type === "file";
          const Icon = isFile ? FileText : Folder;
          const folderItemCount = isFile ? 0 : getFolderItemCount(fileItems, file.path);
          const name = getDisplayName(file, currentFolder);
          return (
            <NativeRow
              key={file.path}
              title={name}
              subtitle={isFile ? formatFileSubtitle(file) : itemCount(folderItemCount)}
              meta={isFile ? formatBytes(file.size) : undefined}
              leading={<Icon size={18} color={tokens.mutedForeground} />}
              trailingAction={
                !isFile && onFolderActions ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={fmt(t.fileTree.folderActions, { name })}
                    hitSlop={mobile.hitSlop}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                    onPress={() => onFolderActions(file.path)}
                  >
                    <MoreHorizontal size={18} color={tokens.mutedForeground} />
                  </Pressable>
                ) : undefined
              }
              last={index === visibleFiles.length - 1}
              onPress={() => (isFile ? onOpenFile(file) : onOpenFolder(file.path))}
            />
          );
        })
      )}
    </NativeSection>
  );
}
