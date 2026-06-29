"use client";

import { Archive, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { BaseVO, NodeVO } from "../../../types";
import { ConfirmActionDialog, EmptyState } from "./primitives";

/** A row in the Trash: an archived base or an archived folder/doc/skill node. */
function TrashRow({
  title,
  description,
  meta,
  restoring,
  error,
  onRestore,
  onPurge,
}: {
  title: string;
  description?: string;
  meta: string;
  restoring: boolean;
  error?: string;
  onRestore: () => void;
  onPurge?: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
      <div className="min-w-0">
        <div className="font-medium text-sm">{title}</div>
        {description ? (
          <div className="mt-0.5 truncate text-muted-foreground text-xs">{description}</div>
        ) : null}
        <div className="mt-0.5 font-mono text-muted-foreground text-xs">{meta}</div>
        {error ? <div className="mt-1 text-red-600 text-xs">{error}</div> : null}
      </div>
      <div className="ml-4 flex shrink-0 items-center gap-2">
        {onPurge ? (
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
            disabled={restoring}
            onClick={onPurge}
            type="button"
          >
            <Trash2 className="size-3" />
            Delete forever
          </button>
        ) : null}
        <button
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
          disabled={restoring}
          onClick={onRestore}
          type="button"
        >
          <RotateCcw className="size-3" />
          {restoring ? "Restoring…" : "Restore"}
        </button>
      </div>
    </div>
  );
}

/**
 * Unified Trash view: archived Bases plus archived folder/doc/skill nodes, each
 * with a Restore action. (Kept the `ArchivedBasesView` export name to avoid
 * churn at the single call site.)
 */
export function ArchivedBasesView({
  archivedBases,
  archivedNodes = [],
  onRestoreBase,
  onRestoreNode,
  onPurgeNode,
}: {
  archivedBases: BaseVO[];
  archivedNodes?: NodeVO[];
  onRestoreBase: (base: BaseVO) => Promise<void>;
  onRestoreNode?: (node: NodeVO) => Promise<void>;
  onPurgeNode?: (node: NodeVO) => Promise<void>;
}) {
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmPurge, setConfirmPurge] = useState<NodeVO | null>(null);
  const [purging, setPurging] = useState(false);

  const runRestore = async (key: string, fn: () => Promise<void>, fallback: string) => {
    setRestoringId(key);
    setErrors((prev) => ({ ...prev, [key]: "" }));
    try {
      await fn();
    } catch (err) {
      setErrors((prev) => ({ ...prev, [key]: err instanceof Error ? err.message : fallback }));
    } finally {
      setRestoringId(null);
    }
  };

  const runPurge = async () => {
    if (!confirmPurge || !onPurgeNode) {
      return;
    }
    const node = confirmPurge;
    setPurging(true);
    setErrors((prev) => ({ ...prev, [node.id]: "" }));
    try {
      await onPurgeNode(node);
      setConfirmPurge(null);
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [node.id]: err instanceof Error ? err.message : "Failed to delete permanently",
      }));
      setConfirmPurge(null);
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="px-6 pt-5 pb-2">
        <div className="flex items-center gap-2">
          <Archive className="size-4 text-muted-foreground" />
          <h1 className="font-semibold text-base">Trash</h1>
        </div>
        <p className="mt-1 text-muted-foreground text-xs">
          Archived items are hidden from the sidebar. Restore to make them active again.
        </p>
      </div>

      <section className="px-6 py-4">
        <h2 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Bases
        </h2>
        {archivedBases.length === 0 ? (
          <EmptyState title="No archived bases" body="Bases you archive will appear here." />
        ) : (
          <div className="space-y-2">
            {archivedBases.map((base) => (
              <TrashRow
                description={base.description || undefined}
                error={errors[base.id]}
                key={base.id}
                meta={base.slug}
                onRestore={() =>
                  runRestore(base.id, () => onRestoreBase(base), "Failed to restore base")
                }
                restoring={restoringId === base.id}
                title={base.name}
              />
            ))}
          </div>
        )}
      </section>

      {onRestoreNode ? (
        <section className="px-6 pb-6">
          <h2 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Folders, docs &amp; skills
          </h2>
          {archivedNodes.length === 0 ? (
            <EmptyState
              title="No archived items"
              body="Folders, docs, and skills you delete will appear here."
            />
          ) : (
            <div className="space-y-2">
              {archivedNodes.map((node) => (
                <TrashRow
                  description={node.description || undefined}
                  error={errors[node.id]}
                  key={node.id}
                  meta={`${node.type} · ${node.slug}`}
                  onPurge={onPurgeNode ? () => setConfirmPurge(node) : undefined}
                  onRestore={() =>
                    runRestore(node.id, () => onRestoreNode(node), "Failed to restore item")
                  }
                  restoring={restoringId === node.id}
                  title={node.name}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      <ConfirmActionDialog
        body={
          confirmPurge ? `Permanently delete "${confirmPurge.name}"? This cannot be undone.` : ""
        }
        confirmLabel="Delete forever"
        onCancel={() => setConfirmPurge(null)}
        onConfirm={runPurge}
        open={confirmPurge !== null}
        pending={purging}
        title="Delete permanently?"
      />
    </div>
  );
}
