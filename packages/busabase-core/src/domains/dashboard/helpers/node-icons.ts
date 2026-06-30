import { getNodeType } from "busabase-contract/domains";
import { FileText, Folder, type LucideIcon, Sparkles, Table2 } from "lucide-react";

/**
 * Maps a node-type definition's platform-neutral `icon` id (declared in each
 * domain's definition.ts) to a concrete lucide-react component. Single source of
 * truth for node icons on web — used by the sidebar tree and the New dialog.
 * Shared by every Busabase host (open-source `apps/busabase` + cloud `busabase-dashboard`).
 */
const ICON_BY_ID: Record<string, LucideIcon> = {
  folder: Folder,
  table: Table2,
  sparkles: Sparkles,
  "file-text": FileText,
};

export const nodeIconForId = (iconId: string | undefined): LucideIcon =>
  (iconId ? ICON_BY_ID[iconId] : undefined) ?? Folder;

export const nodeIconForType = (type: string): LucideIcon => nodeIconForId(getNodeType(type)?.icon);
