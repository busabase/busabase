import type { AssetAttachmentRef, BaseFieldVO } from "busabase-contract/types";
import {
  addDriveEntries,
  countDriveFolderFiles,
  removeDriveEntry,
  withDrivePaths,
} from "busabase-core/base/drive-field-value";
import { useState } from "react";
import { useI18n } from "~/i18n";
import {
  buildDriveListItems,
  createDriveFolder,
  type DriveEditResult,
  type DriveRef,
  deleteDriveFolder,
  describeDriveEditFailure,
  isPendingDriveFolder,
  listDriveFolder,
  renameDriveFile,
  renameDriveFolder,
} from "../utils/drive-field";
import { useAttachmentField } from "./use-attachment-field";

/** At most one sheet is open at a time — a native Modal cannot stack on another. */
export type DriveSheet =
  | { kind: "file"; path: string }
  | { kind: "folder"; path: string }
  | {
      kind: "rename";
      target: "file" | "folder";
      from: string;
      value: string;
      error: string | null;
    }
  | { kind: "newFolder"; value: string; error: string | null }
  | { kind: "removeFolder"; path: string };

interface UseDriveFieldOptions {
  field: BaseFieldVO;
  entries: DriveRef[];
  onChange: (entries: DriveRef[]) => void;
}

/**
 * State for one `drive` field editor: the folder being viewed, the open sheet,
 * and the organising steps. Every step goes through the shared path rules
 * (`busabase-core/base/drive-field-value`, via `../utils/drive-field`), so a
 * refused move shows its reason instead of overwriting a file.
 */
export function useDriveField({ field, entries, onChange }: UseDriveFieldOptions) {
  const { t } = useI18n();
  const [folder, setFolder] = useState("");
  const [sheet, setSheet] = useState<DriveSheet | null>(null);
  const view = { entries, folder };

  // Same picker, upload and `maxFiles` rule as the attachment editor; only
  // where the new file lands differs — the folder being viewed.
  const upload = useAttachmentField({
    maxFiles: field.options.attachment?.maxFiles,
    refs: entries,
    onChange: (refs: AssetAttachmentRef[]) => onChange(withDrivePaths(refs)),
    placeUploaded: (kept, uploaded) => addDriveEntries(kept, [uploaded], folder),
  });

  const items = buildDriveListItems(view);
  const selectedEntry =
    sheet?.kind === "file" ? (entries.find((entry) => entry.path === sheet.path) ?? null) : null;

  const apply = (result: DriveEditResult) => {
    if (result.ok === true) {
      if (result.view.entries !== entries) onChange(result.view.entries);
      setFolder(result.view.folder);
      setSheet(null);
      return;
    }
    if (result.ok === "unchanged") {
      setSheet(null);
      return;
    }
    const error = describeDriveEditFailure(result, t.driveField);
    setSheet((current) =>
      current?.kind === "rename" || current?.kind === "newFolder" ? { ...current, error } : current,
    );
  };

  return {
    folder,
    items,
    visibleItems: listDriveFolder(items, folder),
    pendingFolder: isPendingDriveFolder(view),
    sheet,
    selectedEntry,
    upload,
    countFolderFiles: (path: string) => countDriveFolderFiles(entries, path),
    openFolder: setFolder,
    closeSheet: () => setSheet(null),
    openFile: (path: string) => setSheet({ kind: "file", path }),
    openFolderActions: (path: string) => setSheet({ kind: "folder", path }),
    startNewFolder: () => setSheet({ kind: "newFolder", value: "", error: null }),
    startRename: (target: "file" | "folder", from: string) =>
      setSheet({ kind: "rename", target, from, value: from, error: null }),
    askRemoveFolder: (path: string) => setSheet({ kind: "removeFolder", path }),
    setSheetValue: (value: string) =>
      setSheet((current) =>
        current?.kind === "rename" || current?.kind === "newFolder"
          ? { ...current, value, error: null }
          : current,
      ),
    submitSheet: () => {
      if (sheet?.kind === "newFolder") {
        apply(createDriveFolder(view, sheet.value));
      } else if (sheet?.kind === "rename") {
        apply(
          sheet.target === "file"
            ? renameDriveFile(view, sheet.from, sheet.value)
            : renameDriveFolder(view, sheet.from, sheet.value),
        );
      }
    },
    removeFile: (path: string) => {
      onChange(removeDriveEntry(entries, path));
      setSheet(null);
    },
    confirmRemoveFolder: (path: string) => {
      const next = deleteDriveFolder(view, path);
      onChange(next.entries);
      setFolder(next.folder);
      setSheet(null);
    },
  };
}

export type DriveFieldController = ReturnType<typeof useDriveField>;
