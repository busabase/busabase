import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useState } from "react";
import { useSearch } from "wouter";
import { useCoreI18n, useIString } from "../../../i18n";
import { getRecordTitle } from "../helpers/change-request";
import { getFieldPreviewText } from "../helpers/field";
import { mergeSearchIntoHref } from "../helpers/link-search";

type Choice = { id: string; name: string; color?: string };

// Tailwind-safe swatch classes per choice color (mirrors the select chip palette).
const COLOR_DOT: Record<string, string> = {
  slate: "bg-slate-400",
  violet: "bg-violet-400",
  cyan: "bg-cyan-400",
  emerald: "bg-emerald-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
  orange: "bg-orange-400",
};

const UNCATEGORIZED = "__uncategorized__";

/**
 * Resolve which single-select field stacks the board into columns. Honors the
 * view's `stackByFieldSlug`; otherwise falls back to the first select field on
 * the base (the sensible default so a fresh kanban has columns without config).
 */
export const resolveStackByField = (
  base: BaseVO | null,
  fields: BaseFieldVO[],
  stackByFieldSlug: string | null | undefined,
): BaseFieldVO | null => {
  const selectFields = (base?.fields ?? fields).filter((f) => f.type === "select");
  if (stackByFieldSlug) {
    return selectFields.find((f) => f.slug === stackByFieldSlug) ?? null;
  }
  return selectFields[0] ?? null;
};

function KanbanCard({
  record,
  fields,
  stackFieldSlug,
  baseSlug,
  draggable,
  onDragStart,
}: {
  record: RecordVO;
  fields: BaseFieldVO[];
  stackFieldSlug: string | undefined;
  baseSlug: string;
  draggable: boolean;
  onDragStart: () => void;
}) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const currentSearch = useSearch();
  const title = getRecordTitle(record, messages);
  const primaryFieldSlug = record.base.fields[0]?.slug;
  const bodyFields = fields.filter(
    (field) => field.slug !== primaryFieldSlug && field.slug !== stackFieldSlug,
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: kanban card is a native HTML5 drag source; the title Link remains the keyboard-accessible affordance
    <div
      className={`rounded-md border border-border/60 bg-background p-2.5 shadow-sm transition-shadow hover:shadow-md ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
    >
      <Link
        className="block truncate font-medium text-foreground text-sm hover:underline"
        href={mergeSearchIntoHref(`/base/${baseSlug}/${record.id}`, currentSearch)}
        title={title}
      >
        {title}
      </Link>
      {bodyFields.slice(0, 3).map((field) => {
        const preview = getFieldPreviewText(field, record.headCommit.fields[field.slug], messages);
        if (!preview || preview === "-") {
          return null;
        }
        return (
          <div
            className="mt-1 truncate text-muted-foreground text-xs"
            key={field.id}
            title={`${resolveIString(field.name)}: ${preview}`}
          >
            {preview}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Kanban view — stacks records into columns by a single-select field. Dragging a
 * card to another column writes the new choice back through `onMoveRecord`
 * (which, per busabase's approval model, opens an auto-merged ChangeRequest — an
 * instant change that still leaves an audit trail). Read-only when no move
 * handler is provided.
 */
export function BusaBaseKanban({
  activeView,
  base,
  fields,
  records,
  onMoveRecord,
}: {
  activeView: ViewVO | null;
  base: BaseVO | null;
  fields: BaseFieldVO[];
  records: RecordVO[];
  onMoveRecord?: (record: RecordVO, fieldSlug: string, value: string | null) => Promise<void>;
}) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const stackField = resolveStackByField(base, fields, activeView?.config.stackByFieldSlug);
  const baseSlug = base?.slug ?? records[0]?.base.slug ?? "";

  if (!stackField) {
    return (
      <div className="px-2 py-6 text-muted-foreground text-sm">{messages.base.kanbanNoSelect}</div>
    );
  }

  const choices = (stackField.options.choices ?? []) as Choice[];
  const columns: Array<{ id: string; name: string; color?: string }> = [
    ...choices.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    { id: UNCATEGORIZED, name: messages.base.kanbanUncategorized, color: "slate" },
  ];
  const recordsByColumn = new Map<string, RecordVO[]>();
  for (const column of columns) {
    recordsByColumn.set(column.id, []);
  }
  for (const record of records) {
    const raw = record.headCommit.fields[stackField.slug];
    const key = typeof raw === "string" && recordsByColumn.has(raw) ? raw : UNCATEGORIZED;
    recordsByColumn.get(key)?.push(record);
  }

  const canDrag = Boolean(onMoveRecord);
  const handleDrop = async (columnId: string) => {
    const record = records.find((r) => r.id === draggingId);
    setDraggingId(null);
    setOverColumn(null);
    if (!record || !onMoveRecord) {
      return;
    }
    const current = record.headCommit.fields[stackField.slug];
    const nextValue = columnId === UNCATEGORIZED ? null : columnId;
    if (current === nextValue || (current == null && nextValue === null)) {
      return;
    }
    await onMoveRecord(record, stackField.slug, nextValue);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-5">
      {columns.map((column) => {
        const columnRecords = recordsByColumn.get(column.id) ?? [];
        // Hide the Uncategorized column when nothing is unset (keeps the board tidy).
        if (column.id === UNCATEGORIZED && columnRecords.length === 0) {
          return null;
        }
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: kanban column is a native HTML5 drop target; each card's Link is the keyboard-accessible path
          <div
            className={`flex w-64 shrink-0 flex-col rounded-lg border bg-muted/15 transition-colors ${
              overColumn === column.id ? "border-primary bg-primary/5" : "border-border/50"
            }`}
            key={column.id}
            onDragOver={
              canDrag
                ? (event) => {
                    event.preventDefault();
                    setOverColumn(column.id);
                  }
                : undefined
            }
            onDrop={canDrag ? () => void handleDrop(column.id) : undefined}
          >
            <div className="flex items-center gap-2 border-border/40 border-b px-3 py-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${COLOR_DOT[column.color ?? "slate"] ?? COLOR_DOT.slate}`}
              />
              <span className="truncate font-medium text-foreground text-sm">{column.name}</span>
              <span className="ml-auto rounded-full bg-muted/60 px-1.5 text-muted-foreground text-xs">
                {columnRecords.length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-2">
              {columnRecords.length === 0 ? (
                <div className="px-1 py-4 text-center text-muted-foreground/70 text-xs">
                  {resolveIString(stackField.name)}
                </div>
              ) : (
                columnRecords.map((record) => (
                  <KanbanCard
                    baseSlug={baseSlug}
                    draggable={canDrag}
                    fields={fields}
                    key={record.id}
                    onDragStart={() => setDraggingId(record.id)}
                    record={record}
                    stackFieldSlug={stackField.slug}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
