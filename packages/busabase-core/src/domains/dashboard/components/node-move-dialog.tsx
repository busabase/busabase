"use client";

import { hasCapability } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import { Button } from "kui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "kui/dialog";
import { cn } from "kui/utils";
import { Folder, FolderTree } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useCoreI18n } from "../../../i18n";
import type { MoveNodePayload } from "../hooks/use-move-node";

// A single row in the flattened, indented folder picker.
interface MoveTargetRow {
  id: string;
  name: string;
  depth: number;
}

// Flatten the tree into an ordered, depth-indented list of every node
// eligible to become the new parent (container-capable types only), pre-order
// so a folder always appears directly above its own nested folders — the same
// visual grouping a real folder tree implies. Excludes `excludeId` (the node
// being moved) and any of its descendants: re-parenting a folder under its
// own descendant would orphan the subtree in a cycle, exactly the guard
// `dashboard-shell`'s drag-and-drop `isValidParentId` already applies to
// drops — mirrored here since the dialog doesn't share that closure.
function flattenMoveTargets(nodes: NodeVO[], excludeId: string): MoveTargetRow[] {
  const excludedIds = new Set<string>();
  const collectDescendants = (node: NodeVO) => {
    excludedIds.add(node.id);
    for (const child of node.children) collectDescendants(child);
  };
  const findExcluded = (list: NodeVO[]): NodeVO | undefined => {
    for (const node of list) {
      if (node.id === excludeId) return node;
      const found = findExcluded(node.children);
      if (found) return found;
    }
    return undefined;
  };
  const excludedNode = findExcluded(nodes);
  if (excludedNode) collectDescendants(excludedNode);

  const rows: MoveTargetRow[] = [];
  const visit = (list: NodeVO[], depth: number) => {
    for (const node of list) {
      if (excludedIds.has(node.id)) continue;
      if (hasCapability(node.type, "container")) {
        rows.push({ id: node.id, name: node.name, depth });
        visit(node.children, depth + 1);
      }
    }
  };
  visit(nodes, 0);
  return rows;
}

/**
 * Sidebar "•••" → "Move to…" dialog: an indented folder picker built from the
 * SAME node tree already loaded for the sidebar (`nodes` — no extra fetch),
 * restricted to container-capable nodes (`hasCapability(type, "container")`)
 * and excluding the node being moved plus every one of its own descendants
 * (see `flattenMoveTargets`). Delegates the actual mutation to the host's
 * `onMoveNode` (wired from `useMoveNode`, same mutation drag-and-drop uses)
 * so there is exactly one place that knows how to move a node.
 */
export function NodeMoveDialog({
  nodes,
  node,
  open,
  onOpenChange,
  onMoveNode,
}: {
  /** Full sidebar node tree, exactly as rendered — the root node itself
   * (`nodes[0]` when it's the single unwrapped container) doubles as the
   * "Root" destination, since `nodes.move`'s `parentNodeId` always names a
   * real container node, never an implicit null. */
  nodes: NodeVO[];
  node: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoveNode: (
    payload: MoveNodePayload,
    options?: { onSuccess?: () => void; onError?: () => void },
  ) => void;
}) {
  const messages = useCoreI18n();
  const t = messages.move;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  const rootId = nodes.length === 1 ? nodes[0].id : null;
  const rows = useMemo(() => flattenMoveTargets(nodes, node.id), [nodes, node.id]);

  const handleConfirm = () => {
    if (!selectedId || selectedId === node.id) return;
    setIsMoving(true);
    onMoveNode(
      { nodeId: node.id, parentNodeId: selectedId },
      {
        onSuccess: () => {
          setIsMoving(false);
          onOpenChange(false);
          toast.success(t.success);
        },
        onError: () => {
          setIsMoving(false);
          toast.error(t.failed);
        },
      },
    );
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>{t.dialogDescription.replace("{name}", node.name)}</DialogDescription>
        </DialogHeader>

        <div className="max-h-80 space-y-0.5 overflow-y-auto rounded-md border border-border/60 p-1">
          {rootId && (
            <button
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted",
                selectedId === rootId && "bg-muted font-medium",
              )}
              onClick={() => setSelectedId(rootId)}
              type="button"
            >
              <FolderTree className="size-4 shrink-0 text-muted-foreground" />
              {t.root}
            </button>
          )}
          {rows.length === 0 && !rootId && (
            <p className="px-2 py-1.5 text-muted-foreground text-xs">{t.empty}</p>
          )}
          {rows.map((row) => (
            <button
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted",
                selectedId === row.id && "bg-muted font-medium",
              )}
              key={row.id}
              onClick={() => setSelectedId(row.id)}
              style={{ paddingLeft: 8 + row.depth * 16 }}
              type="button"
            >
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              {row.name}
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            {t.cancel}
          </Button>
          <Button disabled={!selectedId || isMoving} onClick={handleConfirm} type="button">
            {t.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
