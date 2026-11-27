"use client";

import type { BaseVO, NodeVO } from "busabase-contract/types";
import { Archive, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { ConfirmActionDialog, EmptyState } from "./primitives";

/** A row in the Trash: an archived base or an archived folder/doc/skill node. */
function TrashRow({
  title,
  description,
  meta,
  archivedAt,
  restoring,
  error,
  onRestore,
  onPurge,
}: {
  title: string;
  description?: string;
  meta: string;
  archivedAt?: string | null;
  restoring: boolean;
  error?: string;
  onRestore: () => void;
  onPurge?: () => void;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const date = archivedAt ? new Date(archivedAt) : null;

  return (
    // Buttons drop under the name on a phone; beside it they squeezed the name
    // into one or two characters per line.
    <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="font-medium text-sm">{title}</div>
        {description ? (
          <div className="mt-0.5 truncate text-muted-foreground text-xs">{description}</div>
        ) : null}
        <div className="mt-0.5 font-mono text-muted-foreground text-xs">{meta}</div>
        {date && !Number.isNaN(date.getTime()) ? (
          <div className="mt-0.5 text-muted-foreground text-xs">
            {messages.trash.deletedAt}:{" "}
            <time dateTime={archivedAt ?? undefined}>
              {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
                date,
              )}
            </time>
          </div>
        ) : null}
        {error ? <div className="mt-1 text-rejected-strong text-xs">{error}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:ml-4">
        {onPurge ? (
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-rejected/17 hover:text-rejected-strong disabled:opacity-50"
            disabled={restoring}
            onClick={onPurge}
            type="button"
          >
            <Trash2 className="size-3" />
            {messages.trash.deleteForever}
          </button>
        ) : null}
        <button
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
          disabled={restoring}
          onClick={onRestore}
          type="button"
        >
          <RotateCcw className="size-3" />
          {restoring ? messages.common.restoring : messages.common.restore}
        </button>
      </div>
    </div>
  );
}

/** Pending purge confirmation — a Base or a folder/doc/skill node, unified so one
 * ConfirmActionDialog instance serves both Trash sections. */
interface PurgeTarget {
  id: string;
  name: string;
  run: () => Promise<void>;
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
  onPurgeBase,
}: {
  archivedBases: BaseVO[];
  archivedNodes?: NodeVO[];
  onRestoreBase: (base: BaseVO) => Promise<void>;
  onRestoreNode?: (node: NodeVO) => Promise<void>;
  onPurgeNode?: (node: NodeVO) => Promise<void>;
  onPurgeBase?: (base: BaseVO) => Promise<void>;
}) {
  const messages = useCoreI18n();
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmPurge, setConfirmPurge] = useState<PurgeTarget | null>(null);
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
    if (!confirmPurge) {
      return;
    }
    const target = confirmPurge;
    setPurging(true);
    setErrors((prev) => ({ ...prev, [target.id]: "" }));
    try {
      await target.run();
      setConfirmPurge(null);
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [target.id]: err instanceof Error ? err.message : messages.trash.failedDeletePermanently,
      }));
      setConfirmPurge(null);
    } finally {
      setPurging(false);
    }
  };

  return (
    <div
      className="h-full min-h-0 w-full min-w-0 flex-1 overflow-auto"
      data-dashboard-scroll="archived"
    >
      <div className="px-6 pt-5 pb-2">
        <div className="flex items-center gap-2">
          <Archive className="size-4 text-muted-foreground" />
          <h1 className="font-semibold text-base">{messages.trash.title}</h1>
        </div>
        <p className="mt-1 text-muted-foreground text-xs">{messages.trash.body}</p>
      </div>

      <section className="px-6 py-4">
        {archivedBases.length === 0 && (!onRestoreNode || archivedNodes.length === 0) ? (
          <EmptyState
            title={messages.trash.noArchivedItemsTitle}
            body={messages.trash.noArchivedItemsBody}
          />
        ) : (
          <div className="space-y-2">
            {[
              ...archivedBases.map((base) => ({ kind: "base" as const, item: base })),
              ...(onRestoreNode
                ? archivedNodes.map((node) => ({ kind: "node" as const, item: node }))
                : []),
            ]
              .sort((a, b) => {
                const timestamp = (value?: string | null) => {
                  const result = value ? Date.parse(value) : NaN;
                  return Number.isFinite(result) ? result : 0;
                };
                return timestamp(b.item.archivedAt) - timestamp(a.item.archivedAt);
              })
              .map((entry) => {
                const item = entry.item;
                const isBase = entry.kind === "base";
                return (
                  <TrashRow
                    key={`${entry.kind}:${item.id}`}
                    title={item.name}
                    description={item.description || undefined}
                    meta={isBase ? entry.item.slug : `${entry.item.type} · ${entry.item.slug}`}
                    archivedAt={item.archivedAt}
                    error={errors[item.id]}
                    restoring={restoringId === item.id}
                    onRestore={() =>
                      entry.kind === "base"
                        ? runRestore(
                            item.id,
                            () => onRestoreBase(entry.item),
                            messages.trash.failedRestoreBase,
                          )
                        : runRestore(
                            item.id,
                            async () => {
                              if (onRestoreNode) await onRestoreNode(entry.item);
                            },
                            messages.trash.failedRestoreItem,
                          )
                    }
                    onPurge={
                      entry.kind === "base"
                        ? onPurgeBase
                          ? () =>
                              setConfirmPurge({
                                id: item.id,
                                name: item.name,
                                run: () => onPurgeBase(entry.item),
                              })
                          : undefined
                        : onPurgeNode
                          ? () =>
                              setConfirmPurge({
                                id: item.id,
                                name: item.name,
                                run: () => onPurgeNode(entry.item),
                              })
                          : undefined
                    }
                  />
                );
              })}
          </div>
        )}
      </section>

      <ConfirmActionDialog
        body={
          confirmPurge ? fmt(messages.trash.deletePermanentlyBody, { name: confirmPurge.name }) : ""
        }
        confirmLabel={messages.trash.deleteForever}
        onCancel={() => setConfirmPurge(null)}
        onConfirm={runPurge}
        open={confirmPurge !== null}
        pending={purging}
        title={messages.trash.deletePermanentlyTitle}
      />
    </div>
  );
}
