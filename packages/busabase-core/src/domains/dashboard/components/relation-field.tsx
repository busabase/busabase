import { useQuery } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, LookupComputedVO, RecordVO, UserRefVO } from "busabase-contract/types";
import { Checkbox } from "kui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type CoreI18nMessages, fmt, useCoreI18n, useCoreLocale, useIString } from "../../../i18n";
import { relationFieldMessages } from "../../../i18n/relation-field";
import { getMemberIds, isPeopleFieldType } from "../../base/field-types";
import { getPrimaryField } from "../../base/utils/primary-field";
import { getFieldChipEntries, getFieldPreviewText, getRelationRecordIds } from "../helpers/field";
import { formatUserRefLabel } from "../helpers/format";
import { lookupDisplayField, lookupItemValue } from "../helpers/lookup";
import { useLinkedRecords } from "../hooks/use-linked-records";
import { AttachmentValuePreview } from "./attachment-value-preview";
import { FieldBadgeList } from "./field-preview";

// Client instances are scoped to their host/workspace, unlike bare Base IDs.
const clientScopes = new WeakMap<BusabaseDashboardApiClient, number>();
let nextClientScope = 0;
const SELECTED_PAGE_SIZE = 20;
const PREVIEW_VALUE_LIMIT = 3;
const relationRecordTitle = (record: RecordVO, messages: CoreI18nMessages) => {
  const primary = getPrimaryField(record.base);
  return primary
    ? getFieldPreviewText(primary, record.headCommit.payload[primary.slug], messages) ||
        messages.common.record
    : messages.common.record;
};
function clientScope(client: BusabaseDashboardApiClient) {
  let scope = clientScopes.get(client);
  if (scope === undefined) {
    scope = ++nextClientScope;
    clientScopes.set(client, scope);
  }
  return scope;
}

/** Shared add-link control for record forms and grid cells. */
export function RelationFieldAddButton({
  children,
  className = "",
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      className={`inline-flex min-h-7 shrink-0 items-center gap-1 rounded px-2 text-muted-foreground text-sm hover:bg-accent focus-visible:outline-primary disabled:opacity-50 ${className}`}
      type="button"
      {...props}
    >
      <Plus aria-hidden className="size-4" />
      {children}
    </button>
  );
}

export function RelationFieldEditor({
  ariaDescribedBy,
  addButtonFirst = false,
  autoOpen = false,
  client,
  field,
  inputId,
  fieldName,
  footer,
  loadedRecords,
  onChange,
  onOpenChange,
  onEscape,
  value,
}: {
  ariaDescribedBy?: string;
  addButtonFirst?: boolean;
  /** Opens a cell-anchored picker as soon as its inline editor mounts. */
  autoOpen?: boolean;
  client: BusabaseDashboardApiClient;
  field: BaseFieldVO;
  inputId: string;
  fieldName: string;
  footer?: ReactNode;
  loadedRecords: RecordVO[];
  onChange: (value: unknown) => void;
  onOpenChange?: (open: boolean) => boolean | undefined;
  onEscape?: () => void;
  value: string[];
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const resolveIString = useIString();
  const [open, setOpen] = useState(autoOpen);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectionLimit, setSelectionLimit] = useState(SELECTED_PAGE_SIZE);
  const [pickerOffset, setPickerOffset] = useState(4);
  const visibleSelection = value.slice(0, selectionLimit);
  const selectedIds = useMemo(() => new Set(value), [value]);
  const trigger = useRef<HTMLButtonElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const knownRecords = useRef(new Map<string, RecordVO>());
  const targetBaseId = field.options.targetBaseId;
  const scope = clientScope(client);
  const previousScope = useRef(`${scope}:${targetBaseId}`);
  if (previousScope.current !== `${scope}:${targetBaseId}`) {
    knownRecords.current.clear();
    previousScope.current = `${scope}:${targetBaseId}`;
  }
  for (const record of loadedRecords) knownRecords.current.set(record.id, record);

  const updateOpen = useCallback(
    (next: boolean) => {
      if (onOpenChange?.(next) === false) return;
      setOpen(next);
    },
    [onOpenChange],
  );

  useLayoutEffect(() => {
    const container = controls.current;
    const button = trigger.current;
    if (!container || !button) return;
    // The trigger stays outside the scrolling tags. Place the picker below the
    // whole selection area so it cannot cover removal / Show more controls.
    const update = () =>
      setPickerOffset(
        Math.max(
          4,
          container.getBoundingClientRect().bottom - button.getBoundingClientRect().bottom + 4,
        ),
      );
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(container);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    if (query.trim() === search) return;
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, search]);
  // Only the target Base, for its title field. This used to load every Base in
  // the space each time a relation picker opened. The key stays under
  // "relation-bases" so the dashboard's refresh still invalidates it.
  const targetBaseQuery = useQuery({
    enabled: open && Boolean(targetBaseId),
    queryFn: () => client.getBase(targetBaseId as string),
    queryKey: ["busabase", "relation-bases", scope, targetBaseId],
    staleTime: 60_000,
  });
  const targetBase = targetBaseQuery.data;
  const previewFields = [...(targetBase?.fields ?? [])]
    .sort((left, right) => left.position - right.position)
    .slice(0, 5);
  const primarySlug = getPrimaryField(targetBase)?.slug;
  const optionsQuery = useQuery({
    enabled: open && Boolean(targetBase) && (!search || Boolean(primarySlug)),
    queryFn: () =>
      client.listRecordsPage({
        baseId: targetBaseId as string,
        page,
        pageSize: 50,
        ...(search && primarySlug
          ? {
              filters: [
                {
                  fieldSlug: primarySlug,
                  fieldType: "text",
                  operator: "contains" as const,
                  value: search,
                },
              ],
            }
          : {}),
      }),
    queryKey: [
      "busabase",
      "relation-options",
      scope,
      targetBaseId,
      primarySlug ?? "",
      search,
      page,
    ],
  });
  for (const record of optionsQuery.data?.records ?? [])
    knownRecords.current.set(record.id, record);
  // Selected links not already on screen resolve in one batched read. A link
  // that stays unresolved (hidden, removed, or the read failed) keeps its id
  // and renders as unavailable rather than being dropped from the value.
  const selected = useLinkedRecords({
    client,
    ids: visibleSelection.filter((id) => !knownRecords.current.has(id)),
  });
  for (const record of selected.records) knownRecords.current.set(record.id, record);
  // Resolve only the fields shown on the current page, including lookups of
  // relations. One batched read serves all cards; never render raw link ids.
  const previewIds = (optionsQuery.data?.records ?? []).flatMap((record) =>
    previewFields.flatMap((previewField) => {
      const computed = record.computedFields?.[previewField.slug];
      if (previewField.type === "relation") {
        return getRelationRecordIds(record.headCommit.payload[previewField.slug]).slice(
          0,
          PREVIEW_VALUE_LIMIT,
        );
      }
      if (
        previewField.type === "lookup" &&
        computed?.targetField?.type === "relation" &&
        (previewField.options.lookup?.rollup ?? "values") === "values"
      ) {
        return getRelationRecordIds([computed.value].flat(3)).slice(0, PREVIEW_VALUE_LIMIT);
      }
      return [];
    }),
  );
  const previewLinks = useLinkedRecords({
    client,
    enabled: open,
    ids: previewIds.filter((id) => !knownRecords.current.has(id)),
  });
  const previewRecords = new Map(knownRecords.current);
  for (const record of previewLinks.records) previewRecords.set(record.id, record);
  const multiple = field.options.multiple !== false;
  const update = (id: string) => {
    if (selectedIds.has(id)) onChange(multiple ? value.filter((item) => item !== id) : "");
    else onChange(multiple ? [...value, id] : id);
    if (!multiple && !footer) {
      updateOpen(false);
      trigger.current?.focus();
    }
  };
  const failed = optionsQuery.isError || targetBaseQuery.isError;
  const pendingSearch = query.trim() !== search;
  const addButton = (
    <PopoverTrigger asChild>
      <RelationFieldAddButton
        aria-controls={`${inputId}-picker`}
        aria-expanded={open}
        aria-label={fieldName}
        aria-describedby={ariaDescribedBy}
        disabled={!targetBaseId}
        id={inputId}
        ref={trigger}
        title={messages.base.addRelation}
      >
        {value.length === 0 && !addButtonFirst ? messages.base.addRelation : null}
      </RelationFieldAddButton>
    </PopoverTrigger>
  );

  return (
    <Popover onOpenChange={updateOpen} open={open}>
      <div className="relative min-w-0" ref={controls}>
        <div className="flex min-h-9 items-start gap-1.5 rounded-md border border-border/70 bg-card p-1.5">
          {addButtonFirst ? addButton : null}
          {value.length > 0 ? (
            <div className="flex max-h-36 min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-y-auto">
              {visibleSelection.map((id) => {
                const record = knownRecords.current.get(id);
                const title = record
                  ? relationRecordTitle(record, messages)
                  : selected.isPending
                    ? messages.common.loading
                    : messages.base.relationUnavailable;
                return (
                  <span
                    className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-2 py-1 text-sm"
                    key={id}
                  >
                    <span className="truncate" title={title}>
                      {title}
                    </span>
                    <button
                      aria-label={fmt(messages.base.removeRelation, { name: title })}
                      className="shrink-0 rounded p-0.5 hover:bg-accent focus-visible:outline-primary"
                      onClick={() => onChange(multiple ? value.filter((item) => item !== id) : "")}
                      title={fmt(messages.base.removeRelation, { name: title })}
                      type="button"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                );
              })}
              {value.length > selectionLimit ? (
                <button
                  className="rounded px-2 py-1 text-muted-foreground text-xs hover:bg-accent"
                  onClick={() => setSelectionLimit((limit) => limit + SELECTED_PAGE_SIZE)}
                  type="button"
                >
                  {messages.fieldHelp.more} (+{value.length - selectionLimit})
                </button>
              ) : null}
              {selectionLimit > SELECTED_PAGE_SIZE ? (
                <button
                  className="rounded px-2 py-1 text-muted-foreground text-xs hover:bg-accent"
                  onClick={() => setSelectionLimit(SELECTED_PAGE_SIZE)}
                  type="button"
                >
                  {messages.fieldHelp.less}
                </button>
              ) : null}
            </div>
          ) : null}
          {addButtonFirst ? null : addButton}
        </div>
      </div>
      <PopoverContent
        align="start"
        aria-labelledby={`${inputId}-picker-title`}
        className="w-[640px] max-w-[calc(100vw-32px)] overflow-y-auto p-2.5"
        collisionPadding={16}
        sideOffset={pickerOffset}
        data-inline-cell-editor={autoOpen ? field.slug : undefined}
        id={`${inputId}-picker`}
        onCloseAutoFocus={(event) => {
          if (autoOpen) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (!onEscape) return;
          event.preventDefault();
          onEscape();
          updateOpen(false);
        }}
        onKeyDown={(event) => {
          if (autoOpen) event.stopPropagation();
        }}
        onInteractOutside={(event) => {
          // A form re-render can replace the clicked chip's SVG before Radix
          // processes the outside event. Detached targets do not dismiss it.
          if (
            event.target instanceof Node &&
            (!event.target.isConnected || controls.current?.contains(event.target))
          ) {
            event.preventDefault();
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchInput.current?.focus({ preventScroll: true });
        }}
        style={{ maxHeight: "var(--radix-popover-content-available-height)" }}
      >
        <h3 className="mb-2 truncate font-bold text-sm" id={`${inputId}-picker-title`}>
          {targetBase
            ? fmt(relationFieldMessages[locale].title, { name: resolveIString(targetBase.name) })
            : messages.common.loading}
        </h3>
        <input
          aria-label={`${messages.base.searchRecordsToLink} - ${fieldName}`}
          ref={searchInput}
          className="h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none focus:border-primary"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={messages.base.searchRecordsToLink}
          type="search"
          value={query}
        />
        <div
          aria-busy={optionsQuery.isFetching || pendingSearch}
          className="mt-2 max-h-[min(320px,45vh)] space-y-1 overflow-y-auto"
        >
          {failed ? (
            <div className="p-2 text-sm" role="alert">
              {messages.base.relationLoadFailed}
              <button
                className="ml-2 underline"
                onClick={() => {
                  void targetBaseQuery.refetch();
                  void optionsQuery.refetch();
                }}
                type="button"
              >
                {messages.base.paginationRetry}
              </button>
            </div>
          ) : optionsQuery.isPending || pendingSearch ? (
            <div className="p-2 text-muted-foreground text-sm" role="status">
              {messages.common.loading}
            </div>
          ) : optionsQuery.data?.records.length === 0 ? (
            <div className="p-2 text-muted-foreground text-sm" role="status">
              {messages.search.noMatchesTitle}
            </div>
          ) : (
            optionsQuery.data?.records.map((record) => (
              <label
                className={`block cursor-pointer rounded-md p-2.5 text-sm transition-colors hover:bg-accent ${selectedIds.has(record.id) ? "bg-accent" : ""}`}
                htmlFor={`${inputId}-option-${record.id}`}
                key={record.id}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    className="min-w-0 flex-1 truncate font-semibold text-sm"
                    title={relationRecordTitle(record, messages)}
                  >
                    {relationRecordTitle(record, messages)}
                  </span>
                  <Checkbox
                    aria-label={relationRecordTitle(record, messages)}
                    checked={selectedIds.has(record.id)}
                    id={`${inputId}-option-${record.id}`}
                    onCheckedChange={() => update(record.id)}
                    name={inputId}
                  />
                </span>
                <RelationRecordDetails
                  fields={previewFields.filter((item) => item.slug !== primarySlug)}
                  linkedRecords={previewRecords}
                  linksPending={previewLinks.isPending}
                  record={record}
                />
              </label>
            ))
          )}
        </div>
        {(optionsQuery.data?.totalPages ?? 0) > 1 ? (
          <nav
            aria-label={messages.base.paginationLabel}
            className="mt-1 flex items-center justify-between border-border border-t pt-2 text-xs"
          >
            <button
              aria-label={messages.base.paginationPreviousPage}
              disabled={page === 1 || optionsQuery.isFetching || pendingSearch}
              onClick={() => setPage(page - 1)}
              title={messages.base.paginationPreviousPage}
              type="button"
              className="rounded p-1 hover:bg-accent disabled:opacity-40"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span>
              {page} / {optionsQuery.data?.totalPages}
            </span>
            <button
              aria-label={messages.base.paginationNextPage}
              disabled={
                page >= (optionsQuery.data?.totalPages ?? 1) ||
                optionsQuery.isFetching ||
                pendingSearch
              }
              onClick={() => setPage(page + 1)}
              title={messages.base.paginationNextPage}
              type="button"
              className="rounded p-1 hover:bg-accent disabled:opacity-40"
            >
              <ChevronRight className="size-4" />
            </button>
          </nav>
        ) : null}
        {footer ? <div className="mt-2 border-border border-t pt-2">{footer}</div> : null}
      </PopoverContent>
    </Popover>
  );
}

/** Bounded, non-interactive field summaries keep the whole candidate selectable. */
function RelationRecordDetails({
  fields,
  linkedRecords,
  linksPending,
  record,
}: {
  fields: BaseFieldVO[];
  linkedRecords: Map<string, RecordVO>;
  linksPending: boolean;
  record: RecordVO;
}) {
  const resolveIString = useIString();
  if (!fields.length) return null;
  const isAttachment = (field: BaseFieldVO) => {
    const displayField =
      field.type === "lookup" ? record.computedFields?.[field.slug]?.targetField : field;
    return displayField?.type === "attachment" || displayField?.type === "drive";
  };
  const orderedFields = [...fields].sort(
    (left, right) => Number(isAttachment(left)) - Number(isAttachment(right)),
  );
  return (
    <span className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
      {orderedFields.map((field) => {
        const value = record.headCommit.payload[field.slug];
        return (
          <span className="min-w-0" data-relation-preview-field={field.slug} key={field.id}>
            <span className="mb-1 block truncate text-muted-foreground text-[11px]">
              {resolveIString(field.name)}
            </span>
            <span className="block max-h-12 overflow-hidden text-foreground">
              <RelationPreviewValue
                computed={record.computedFields?.[field.slug]}
                field={field}
                fieldUsers={record.fieldUsers}
                linkedRecords={linkedRecords}
                linksPending={linksPending}
                value={value}
              />
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Plain summaries keep links and lookup source controls out of option labels. */
function RelationPreviewValue({
  computed,
  field,
  fieldUsers,
  linkedRecords,
  linksPending,
  value,
}: {
  computed?: LookupComputedVO;
  field: BaseFieldVO;
  fieldUsers?: Record<string, UserRefVO>;
  linkedRecords: Map<string, RecordVO>;
  linksPending: boolean;
  value: unknown;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  if (field.type === "lookup") {
    if (!computed) return <span>-</span>;
    if (computed.status === "invalid" || computed.status === "inaccessible") {
      return <span>{messages.lookup[computed.status]}</span>;
    }
    if (computed.status === "empty" || computed.status === "unlinked") return <span>-</span>;
    const rollup = field.options.lookup?.rollup ?? "values";
    const displayField = computed.targetField
      ? lookupDisplayField(computed.targetField, rollup)
      : undefined;
    if (displayField) {
      if (
        rollup === "values" &&
        (displayField.type === "attachment" ||
          displayField.type === "drive" ||
          displayField.type === "relation")
      ) {
        return (
          <RelationPreviewValue
            field={displayField}
            linkedRecords={linkedRecords}
            linksPending={linksPending}
            value={[computed.value].flat(2)}
          />
        );
      }
      const values = Array.isArray(computed.value) ? computed.value : [computed.value];
      return (
        <span className="flex flex-wrap gap-1">
          {values.slice(0, PREVIEW_VALUE_LIMIT).map((item, index) => (
            <RelationPreviewValue
              field={displayField}
              fieldUsers={fieldUsers}
              key={`${index}:${JSON.stringify(item)}`}
              linkedRecords={linkedRecords}
              linksPending={linksPending}
              value={rollup === "values" ? lookupItemValue(displayField, item) : item}
            />
          ))}
          {values.length > PREVIEW_VALUE_LIMIT ? (
            <span className="text-muted-foreground text-xs">
              +{values.length - PREVIEW_VALUE_LIMIT}
            </span>
          ) : null}
        </span>
      );
    }
    value = computed.value;
  }
  if (field.type === "attachment" || field.type === "drive") {
    return (
      <AttachmentValuePreview maxVisible={1} presentation="grid" rowHeight={48} value={value} />
    );
  }
  const ids =
    field.type === "relation"
      ? getRelationRecordIds([value].flat(3))
      : isPeopleFieldType(field.type)
        ? getMemberIds(value)
        : [];
  const labels = ids.slice(0, PREVIEW_VALUE_LIMIT).map((id) => {
    if (field.type === "relation") {
      const linked = linkedRecords.get(id);
      return linked
        ? relationRecordTitle(linked, messages)
        : linksPending
          ? messages.common.loading
          : messages.base.relationUnavailable;
    }
    return formatUserRefLabel(fieldUsers?.[id], undefined, messages);
  });
  if (labels.length) {
    return (
      <span className="flex flex-wrap gap-1">
        {labels.map((label, index) => (
          <span
            className="max-w-full truncate rounded bg-muted px-2 py-0.5 text-xs"
            key={`${index}:${label}`}
            title={label}
          >
            {label}
          </span>
        ))}
        {ids.length > PREVIEW_VALUE_LIMIT ? (
          <span className="text-muted-foreground text-xs">+{ids.length - PREVIEW_VALUE_LIMIT}</span>
        ) : null}
      </span>
    );
  }
  if (field.type === "relation" || isPeopleFieldType(field.type)) return <span>-</span>;
  const chips = getFieldChipEntries(field, value);
  if (chips.length)
    return (
      <span className="flex gap-1">
        <FieldBadgeList chips={chips.slice(0, PREVIEW_VALUE_LIMIT)} />
        {chips.length > PREVIEW_VALUE_LIMIT ? (
          <span className="text-muted-foreground text-xs">
            +{chips.length - PREVIEW_VALUE_LIMIT}
          </span>
        ) : null}
      </span>
    );
  const text = getFieldPreviewText(field, value, messages, locale) || "-";
  return (
    <span className="line-clamp-2 break-words" title={text}>
      {text}
    </span>
  );
}
