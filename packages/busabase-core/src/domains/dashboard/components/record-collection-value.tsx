import type { BaseFieldVO, RecordVO } from "busabase-contract/types";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import { List } from "lucide-react";
import { type ReactNode, useState } from "react";
import { fmt, useCoreLocale, useIString } from "../../../i18n";
import { detailValuesMessages } from "../../../i18n/detail-values";
import { getRelationRecordIds } from "../helpers/field";
import { FieldValuePreview } from "./field-preview";
import { DialogContent } from "./localized-dialog-content";

// Up to 21 values fit inline; larger collections use 20 values plus one more-items action.
const INLINE_COLLECTION_LIMIT = 21;
const PREVIEW_COLLECTION_LIMIT = 20;

/** Expanded collection presentation belongs to record details, not grid cells. */
export function RecordCollectionValue({
  field,
  record,
  records,
  value,
}: {
  field: BaseFieldVO;
  record: RecordVO;
  records: RecordVO[];
  value: unknown;
}) {
  const [open, setOpen] = useState(false);
  const locale = useCoreLocale();
  const resolveIString = useIString();
  const computed = record.computedFields?.[field.slug];
  const result = computed ? computed.value : value;
  const unavailable =
    computed && ["invalid", "inaccessible", "empty", "unlinked"].includes(computed.status);
  const count = unavailable
    ? 0
    : field.type === "relation"
      ? getRelationRecordIds(value).length
      : Array.isArray(result)
        ? result.length
        : result === null || result === undefined || result === ""
          ? 0
          : 1;
  const preview = (limit?: number, trailing?: ReactNode, showSources = false) => (
    <FieldValuePreview
      className="text-sm leading-5"
      field={field}
      computed={
        computed && limit && Array.isArray(computed.value)
          ? { ...computed, value: computed.value.slice(0, limit) }
          : computed
      }
      fieldUsers={record.fieldUsers}
      record={record}
      records={records}
      value={
        limit
          ? field.type === "relation"
            ? getRelationRecordIds(value).slice(0, limit)
            : Array.isArray(value)
              ? value.slice(0, limit)
              : value
          : value
      }
      showAllLookupValues
      showLookupSources={showSources}
      collectionTrailing={trailing}
    />
  );
  if (count <= INLINE_COLLECTION_LIMIT) return preview(undefined, undefined, true);
  const label = fmt(detailValuesMessages[locale].count, { count });
  return (
    <>
      {preview(
        PREVIEW_COLLECTION_LIMIT,
        <button
          aria-label={label}
          title={label}
          className="inline-flex shrink-0 items-center rounded px-1 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          data-testid={`record-collection-count-${field.slug}`}
          onClick={() => setOpen(true)}
          type="button"
        >
          <List aria-hidden size={16} />
        </button>,
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto"
          data-testid="record-collection-dialog"
        >
          <DialogHeader>
            <DialogTitle>{resolveIString(field.name)}</DialogTitle>
            <DialogDescription>{label}</DialogDescription>
          </DialogHeader>
          <div className="min-w-0 break-words">{preview(undefined, undefined, true)}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}
