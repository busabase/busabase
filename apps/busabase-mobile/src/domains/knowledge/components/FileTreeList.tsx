import { ArrowUp, FileText, Folder } from "lucide-react-native";
import { NativeRow, NativeSection } from "~/components/native-screen";
import { formatBytes } from "~/lib/format";
import { useTokens } from "~/theme/use-tokens";
import type { FileTreeListItem } from "../types/file-tree";
import {
  formatFileSubtitle,
  formatItemCount,
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
}

export function FileTreeList({
  currentFolder,
  fileItems,
  totalFileCount,
  visibleFiles,
  onOpenFile,
  onOpenFolder,
}: FileTreeListProps) {
  const tokens = useTokens();

  return (
    <NativeSection title={currentFolder || "Root"} caption={formatItemCount(visibleFiles.length)}>
      {currentFolder ? (
        <NativeRow
          title={getParentFolder(currentFolder) || "Root"}
          leading={<ArrowUp size={18} color={tokens.mutedForeground} />}
          onPress={() => onOpenFolder(getParentFolder(currentFolder))}
        />
      ) : null}
      {visibleFiles.length === 0 ? (
        <NativeRow
          title={totalFileCount === 0 ? "No files" : "Empty folder"}
          leading={<FileText size={18} color={tokens.mutedForeground} />}
          last
        />
      ) : (
        visibleFiles.map((file, index) => {
          const isFile = file.type === "file";
          const Icon = isFile ? FileText : Folder;
          const folderItemCount = isFile ? 0 : getFolderItemCount(fileItems, file.path);
          return (
            <NativeRow
              key={file.path}
              title={getDisplayName(file, currentFolder)}
              subtitle={isFile ? formatFileSubtitle(file) : formatItemCount(folderItemCount)}
              meta={isFile ? formatBytes(file.size) : undefined}
              leading={<Icon size={18} color={tokens.mutedForeground} />}
              last={index === visibleFiles.length - 1}
              onPress={() => (isFile ? onOpenFile(file) : onOpenFolder(file.path))}
            />
          );
        })
      )}
    </NativeSection>
  );
}
