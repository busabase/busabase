import type {
  BaseFieldVO,
  BaseVO,
  GalleryCardSize,
  GalleryCoverFit,
  RecordVO,
  ViewVO,
} from "busabase-contract/types";
import { ImageOff, Paperclip, RotateCcw } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useSearch } from "wouter";
import { useCoreI18n, useIString } from "../../../i18n";
import { getRecordTitle } from "../helpers/change-request";
import { getAttachmentRefs, getFieldPreviewText, getSafeAttachmentUrl } from "../helpers/field";
import { mergeSearchIntoHref } from "../helpers/link-search";

// Card min-width per size preset — column count is left to CSS `auto-fill`
// (responsive reflow), matching Airtable/Notion which don't let you drag a
// free card size.
const CARD_MIN_WIDTH: Record<GalleryCardSize, string> = {
  small: "150px",
  medium: "220px",
  large: "300px",
};

/**
 * Resolve which attachment field supplies the cover image. Honors the view's
 * explicit `coverFieldSlug`; otherwise falls back to the first attachment field
 * on the base (the sensible default every gallery tool uses so a fresh gallery
 * shows images without any configuration).
 */
export const resolveCoverField = (
  base: BaseVO | null,
  fields: BaseFieldVO[],
  coverFieldSlug: string | null | undefined,
): BaseFieldVO | null => {
  const attachmentFields = (base?.fields ?? fields).filter((f) => f.type === "attachment");
  if (coverFieldSlug === null) {
    // Explicitly "no cover".
    return null;
  }
  if (coverFieldSlug) {
    return attachmentFields.find((f) => f.slug === coverFieldSlug) ?? null;
  }
  return attachmentFields[0] ?? null;
};

const firstImageUrl = (record: RecordVO, coverField: BaseFieldVO | null): string | null => {
  if (!coverField) {
    return null;
  }
  const attachments = getAttachmentRefs(record.headCommit.fields[coverField.slug]);
  for (const attachment of attachments) {
    if (attachment.mimeType?.startsWith("image/")) {
      const url = getSafeAttachmentUrl(attachment);
      if (url) {
        return url;
      }
    }
  }
  return null;
};

function GalleryCard({
  record,
  fields,
  coverField,
  coverFit,
  showFieldLabels,
  baseSlug,
  faded,
  onRestore,
}: {
  record: RecordVO;
  fields: BaseFieldVO[];
  coverField: BaseFieldVO | null;
  coverFit: GalleryCoverFit;
  showFieldLabels: boolean;
  baseSlug: string;
  faded?: boolean;
  onRestore?: () => void;
}) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const currentSearch = useSearch();
  const title = getRecordTitle(record, messages);
  const coverUrl = firstImageUrl(record, coverField);
  // The primary field is the card title — don't repeat it in the body.
  const primaryFieldSlug = record.base.fields[0]?.slug;
  const bodyFields = fields.filter(
    (field) => field.slug !== primaryFieldSlug && field.slug !== coverField?.slug,
  );

  const cover =
    coverUrl != null ? (
      <img
        alt={title}
        className={`h-full w-full ${coverFit === "fit" ? "object-contain" : "object-cover"}`}
        src={coverUrl}
      />
    ) : (
      // No-image fallback: keep the cover area at the same fixed aspect ratio so
      // the grid never collapses, and show the record's title initial.
      <div className="flex h-full w-full items-center justify-center bg-muted/50 text-muted-foreground">
        {coverField ? (
          <span className="font-semibold text-2xl uppercase opacity-70">
            {title.trim().charAt(0) || "?"}
          </span>
        ) : (
          <ImageOff size={22} className="opacity-40" />
        )}
      </div>
    );

  return (
    <div
      className={`group flex flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm transition-shadow hover:shadow-md ${
        faded ? "opacity-60 hover:opacity-100" : ""
      }`}
    >
      <Link
        className="block aspect-[3/2] w-full overflow-hidden bg-muted/30"
        href={mergeSearchIntoHref(`/base/${baseSlug}/${record.id}`, currentSearch)}
      >
        {cover}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2.5">
        <Link
          className="truncate font-medium text-foreground text-sm hover:underline"
          href={mergeSearchIntoHref(`/base/${baseSlug}/${record.id}`, currentSearch)}
          title={title}
        >
          {title}
        </Link>
        {bodyFields.map((field) => {
          const preview = getFieldPreviewText(
            field,
            record.headCommit.fields[field.slug],
            messages,
          );
          if (!preview || preview === "-") {
            return null;
          }
          return (
            <div className="min-w-0" key={field.id}>
              {showFieldLabels ? (
                <div className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">
                  {resolveIString(field.name)}
                </div>
              ) : null}
              <div className="truncate text-muted-foreground text-xs" title={preview}>
                {field.type === "attachment" ? (
                  <span className="inline-flex items-center gap-1">
                    <Paperclip size={10} className="shrink-0" />
                    {preview}
                  </span>
                ) : (
                  preview
                )}
              </div>
            </div>
          );
        })}
        {faded && onRestore ? (
          <button
            className="mt-1 inline-flex w-fit items-center gap-1 rounded border border-border/60 bg-background px-2 py-0.5 text-xs transition-colors hover:bg-accent"
            onClick={onRestore}
            type="button"
          >
            <RotateCcw className="size-3" />
            {messages.common.restore}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Gallery view — a responsive card wall over the same records the table view
 * shows. It only changes how records are presented; filtering/sorting still come
 * from the shared `applyViewConfigToRecords`, so the underlying data is one copy.
 */
export function BusaBaseGallery({
  activeView,
  base,
  fields,
  records,
  archivedRecords = [],
  showArchivedRecords = false,
  onRestoreRecord,
}: {
  activeView: ViewVO | null;
  base: BaseVO | null;
  fields: BaseFieldVO[];
  records: RecordVO[];
  archivedRecords?: RecordVO[];
  showArchivedRecords?: boolean;
  onRestoreRecord?: (record: RecordVO) => Promise<void>;
}) {
  const messages = useCoreI18n();
  const config = activeView?.config;
  const coverField = resolveCoverField(base, fields, config?.coverFieldSlug);
  const coverFit: GalleryCoverFit = config?.coverFit ?? "cover";
  const cardSize: GalleryCardSize = config?.cardSize ?? "medium";
  const showFieldLabels = config?.showFieldLabels ?? false;
  const baseSlug = base?.slug ?? records[0]?.base.slug ?? "";

  if (records.length === 0 && !(showArchivedRecords && archivedRecords.length > 0)) {
    return (
      <div className="px-2 py-6 text-muted-foreground text-sm">{messages.base.emptyRecords}</div>
    );
  }

  return (
    <div
      className="grid gap-3 pb-5"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN_WIDTH[cardSize]}, 1fr))` }}
    >
      {records.map((record) => (
        <GalleryCard
          baseSlug={baseSlug}
          coverField={coverField}
          coverFit={coverFit}
          fields={fields}
          key={record.id}
          record={record}
          showFieldLabels={showFieldLabels}
        />
      ))}
      {showArchivedRecords
        ? archivedRecords.map((record) => (
            <GalleryCard
              baseSlug={baseSlug}
              coverField={coverField}
              coverFit={coverFit}
              faded
              fields={fields}
              key={record.id}
              onRestore={onRestoreRecord ? () => void onRestoreRecord(record) : undefined}
              record={record}
              showFieldLabels={showFieldLabels}
            />
          ))
        : null}
    </div>
  );
}
