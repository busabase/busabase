"use client";

import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, RecordVO } from "busabase-contract/types";
import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  ExternalLink,
  LoaderCircle,
  X,
} from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useSearch } from "wouter";
import { fmt, useCoreI18n, useCoreLocale, useIString } from "../../../i18n";
import {
  type InlineCellEditMessages,
  inlineCellEditMessages,
} from "../../../i18n/inline-cell-edit";
import { fieldLinkPrefix } from "../../base/field-types";
import { getDateFieldOptions, parseDateFieldValue } from "../../base/utils/date-value";
import { getEditorFieldValue, getFieldChipEntries, getFieldPreviewText } from "../helpers/field";
import { fieldValueToString } from "../helpers/format";
import { buildGridCellText } from "../helpers/grid-cell-layout";
import {
  getInlineCellEditorKind,
  type InlineCellDraftError,
  type InlineCellEditorKind,
  preserveInlineTextLineEndings,
  toInlineCellDraft,
} from "../helpers/inline-cell-edit";
import { mergeSearchIntoHref } from "../helpers/link-search";
import { TABLE_CELL_LINK_MAX_CHARS } from "../helpers/table-cell-preview";
import {
  type BaseGridEditing,
  type GridCellStatus,
  type GridMove,
  type GridNotice,
  gridCellKey,
} from "../hooks/use-base-grid-editing";
import { ChoiceOptionsPanel, choicePopoverClassName } from "./choice-field";
import { DateFieldInput, DateFieldValue } from "./date-field";
import { FieldBadge } from "./field-preview";
import { GridCellText } from "./grid-cell-presentation";
import { RelationFieldEditor } from "./relation-field";
import { SplitSubmitButton } from "./split-submit-button";

/**
 * The grid's editing controller plus the one cell that holds the tab stop.
 * Null when in-cell editing is off (read-only viewers, touch screens, hosts
 * that wire no cell write) — cells then render exactly as before.
 */
export type BaseGridEditingContextValue = BaseGridEditing & { tabStopKey: string | null };

export const useInlineCellEditMessages = (): InlineCellEditMessages =>
  inlineCellEditMessages[useCoreLocale()];

/**
 * In-cell editing is a pointer-and-keyboard interaction. On a touch-only
 * screen a tap must keep opening the record (the 48px cells are too small to
 * edit in), so the grid stays read-only there and editing happens in the
 * record form, as before.
 */
export const useHasFinePointer = (): boolean => {
  const query = "(any-pointer: fine)";
  const [fine, setFine] = useState(() =>
    typeof window === "undefined" || !window.matchMedia ? true : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setFine(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return fine;
};

export const describeInlineCellError = (
  copy: InlineCellEditMessages,
  error: InlineCellDraftError,
  fieldName: string,
): string => {
  switch (error) {
    case "required":
      return fmt(copy.errorRequired, { field: fieldName });
    case "number":
      return copy.errorNumber;
    case "email":
      return copy.errorEmail;
    case "url":
      return copy.errorUrl;
    case "phone":
      return copy.errorPhone;
    case "date":
      return copy.errorDate;
    case "choice":
      return copy.errorChoice;
    default:
      return copy.errorInvalid;
  }
};

/** A value that can be edited in place, shown the way the read-only grid shows it. */
export function InlineEditableCellValue({
  active,
  field,
  index,
  onToggle,
  value,
  rowHeight = 48,
  recordHref,
  onOpenRecord,
}: {
  active: boolean;
  field: BaseFieldVO;
  index: number;
  onToggle: () => void;
  value: unknown;
  rowHeight?: number;
  recordHref: string;
  onOpenRecord?: () => void;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const resolveIString = useIString();
  const kind = getInlineCellEditorKind(field);
  const textClassName = index === 0 ? "font-medium text-foreground" : "text-muted-foreground";

  if (kind === "checkbox") {
    const checked = value === true || value === "true";
    return (
      // A span, not a button: the cell is the focus target and the keyboard
      // handler toggles it, so a native button would toggle twice on Space.
      // biome-ignore lint/a11y/useFocusableInteractive: the grid cell around it carries focus (roving tabindex).
      <span
        aria-checked={checked}
        aria-label={resolveIString(field.name)}
        className={`inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border transition-colors ${
          checked
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-border/70 bg-muted/30 text-muted-foreground hover:border-primary/40"
        }`}
        data-inline-checkbox
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        role="checkbox"
        title={checked ? messages.common.yes : messages.common.no}
      >
        {checked ? <Check aria-hidden size={12} /> : null}
      </span>
    );
  }

  if (kind === "select") {
    const chips = getFieldChipEntries(field, value);
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {chips[0] ? (
          <FieldBadge chip={chips[0]} />
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
        <ChevronDown
          aria-hidden
          className={`ml-auto size-3.5 shrink-0 text-muted-foreground transition-opacity ${
            active ? "opacity-100" : "opacity-0 group-hover:opacity-60"
          }`}
        />
      </span>
    );
  }

  if (kind === "date") {
    return (
      <GridCellText className={textClassName} rowHeight={rowHeight} scalar>
        {parseDateFieldValue(value) ? (
          <DateFieldValue options={getDateFieldOptions(field.options)} value={value} />
        ) : (
          fieldValueToString(value) || "-"
        )}
      </GridCellText>
    );
  }

  if (kind === "url" || kind === "email" || kind === "tel") {
    const preview = buildGridCellText(value);
    if (typeof value === "string" ? value.length > TABLE_CELL_LINK_MAX_CHARS : preview.truncated) {
      const openRecord = (event: MouseEvent<HTMLAnchorElement>) => {
        event.stopPropagation();
        if (
          !onOpenRecord ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        onOpenRecord();
      };
      return (
        <Link
          className="min-w-0 truncate text-muted-foreground text-xs"
          data-table-preview-bounded="true"
          href={recordHref}
          onClick={openRecord}
          onDoubleClick={(event) => event.stopPropagation()}
          title={messages.operation.viewFullContent}
        >
          {messages.operation.viewFullContent}
        </Link>
      );
    }
    const text = typeof value === "string" ? value.trim() : preview.text;
    if (!text) return <span className="text-muted-foreground">-</span>;
    const prefix = fieldLinkPrefix(field.type);
    const external = prefix === "";
    return (
      <a
        className="flex min-w-0 items-center gap-1.5 text-primary underline-offset-2 hover:underline"
        href={`${prefix}${text}`}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        rel={external ? "noreferrer" : undefined}
        target={external ? "_blank" : undefined}
        title={preview.text}
      >
        <GridCellText rowHeight={rowHeight}>{preview.text}</GridCellText>
        {external ? <ExternalLink className="shrink-0" size={12} /> : null}
      </a>
    );
  }

  const text =
    kind === "number"
      ? getFieldPreviewText(field, value, messages, locale)
      : buildGridCellText(value).text;
  return (
    <GridCellText className={textClassName} rowHeight={rowHeight} scalar={kind === "number"}>
      {text || "-"}
    </GridCellText>
  );
}

/** Saving / waiting-for-review / failed, at the end of the cell. */
export function InlineCellStatusBadge({
  field,
  status,
}: {
  field: BaseFieldVO;
  status: GridCellStatus;
}) {
  const copy = useInlineCellEditMessages();
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const currentSearch = useSearch();
  if (status.saving) {
    return (
      <span
        className="ml-auto inline-flex shrink-0 items-center pl-1 text-muted-foreground"
        data-inline-cell-status="saving"
        title={copy.saving}
      >
        <LoaderCircle aria-hidden className="size-3 animate-spin" />
        <span className="sr-only">{copy.saving}</span>
      </span>
    );
  }
  if (status.error) {
    return (
      <span
        className="ml-auto inline-flex shrink-0 items-center pl-1 text-destructive"
        data-inline-cell-status="error"
        title={status.error}
      >
        <CircleAlert aria-hidden className="size-3.5" />
        <span className="sr-only">{status.error}</span>
      </span>
    );
  }
  if (status.pending) {
    const proposed =
      getFieldPreviewText(field, status.pending.proposedValue, messages, locale) || copy.empty;
    return (
      <Link
        className="ml-auto inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground leading-4 transition-colors hover:bg-accent hover:text-foreground"
        data-inline-cell-status="pending"
        href={mergeSearchIntoHref(`/inbox/${status.pending.changeRequestId}`, currentSearch)}
        tabIndex={-1}
        title={fmt(copy.pendingTitle, { value: proposed })}
      >
        <Clock3 aria-hidden className="size-3" />
        {copy.pending}
      </Link>
    );
  }
  return null;
}

// The notice lives inside the grid's horizontal scroller; `sticky left-0` keeps
// it in view when the user has scrolled far right to reach a column (a Price
// column is often the last one).
const noticeLayoutClassName =
  "sticky left-0 mb-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs";

/** Feedback for the last in-cell write, above the grid and announced to screen readers. */
export function InlineEditNotice({
  notice,
  onDismiss,
}: {
  notice: GridNotice | null;
  onDismiss: () => void;
}) {
  const copy = useInlineCellEditMessages();
  const messages = useCoreI18n();
  const currentSearch = useSearch();
  if (!notice) return null;
  const dismiss = (
    <button
      aria-label={messages.common.close}
      className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onClick={onDismiss}
      type="button"
    >
      <X aria-hidden className="size-3.5" />
    </button>
  );
  if (notice.kind === "error") {
    return (
      <div
        className={`${noticeLayoutClassName} border-destructive/30 bg-destructive/5 text-destructive`}
        data-testid="inline-edit-notice"
        role="alert"
      >
        <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0">
          {fmt(copy.saveFailed, { field: notice.fieldName, error: notice.message })}
        </span>
        {dismiss}
      </div>
    );
  }
  return (
    <div
      aria-live="polite"
      className={`${noticeLayoutClassName} border-border/60 bg-muted/40 text-muted-foreground`}
      data-testid="inline-edit-notice"
      role="status"
    >
      {notice.kind === "pending" ? (
        <>
          <Clock3 aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">
            {fmt(notice.requested ? copy.savedAsChangeRequest : copy.submittedForReview, {
              field: notice.fieldName,
            })}{" "}
            <Link
              className="text-primary underline-offset-2 hover:underline"
              href={mergeSearchIntoHref(`/inbox/${notice.changeRequestId}`, currentSearch)}
            >
              {messages.base.viewSubmittedRequest}
            </Link>
          </span>
        </>
      ) : (
        <span className="min-w-0">{fmt(copy.readOnlyCell, { field: notice.fieldName })}</span>
      )}
      {dismiss}
    </div>
  );
}

/** Keeps a ref that is false once the editor unmounts, so a removal blur never commits. */
const useAliveRef = () => {
  const alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
};

const isComposing = (event: KeyboardEvent) =>
  event.nativeEvent.isComposing || event.keyCode === 229;

/**
 * The editor that replaces a cell's value while it is being edited. Select and
 * date cells open the record form's own controls (`ChoiceOptionsPanel`,
 * `DateFieldInput`) anchored to the cell; text, number, URL, email and phone
 * get a one-line input. What any of them produce goes through the form's
 * normalize + validate (`parseInlineCellDraft`) before it is saved.
 */
export function InlineCellEditor({
  client,
  field,
  grid,
  relationRecords,
  record,
}: {
  client: BusabaseDashboardApiClient;
  field: BaseFieldVO;
  grid: BaseGridEditing;
  relationRecords: RecordVO[];
  record: RecordVO;
}) {
  const kind = getInlineCellEditorKind(field);
  if (!kind || kind === "checkbox") return null;
  if (kind === "relation")
    return (
      <InlineRelationCellEditor
        client={client}
        field={field}
        grid={grid}
        loadedRecords={relationRecords}
        record={record}
      />
    );
  if (kind === "select")
    return <InlineSelectCellEditor field={field} grid={grid} record={record} />;
  if (kind === "date") return <InlineDateCellEditor field={field} grid={grid} record={record} />;
  return <InlineTextCellEditor field={field} grid={grid} kind={kind} record={record} />;
}

const INPUT_MODE: Partial<Record<InlineCellEditorKind, "decimal" | "url" | "email" | "tel">> = {
  number: "decimal",
  url: "url",
  email: "email",
  tel: "tel",
};

/**
 * The explicit way to finish an in-cell edit, so saving never depends on the
 * Enter key alone: Cancel, plus the permission-aware submit control the record
 * form and documents use — Save now, or Save as Change Request from its menu;
 * someone who may only propose gets just the request. Enter and clicking away
 * keep saving with the main action, and Esc keeps cancelling.
 */
function InlineCellSubmitActions({
  dropdownPosition,
  onCancel,
  onMenuCloseAutoFocus,
  onSubmit,
}: {
  dropdownPosition?: "above" | "below";
  onCancel: () => void;
  onMenuCloseAutoFocus?: (event: Event) => void;
  onSubmit: (mergeImmediately: boolean) => void;
}) {
  const messages = useCoreI18n();
  return (
    <div className="flex items-center justify-end gap-2" data-inline-cell-actions>
      <button
        className="rounded-md border border-border/70 bg-card px-3 py-1.5 font-medium text-xs transition-colors hover:bg-accent"
        onClick={onCancel}
        type="button"
      >
        {messages.common.cancel}
      </button>
      <SplitSubmitButton
        changeRequestAction={{
          label: messages.nodeDetail.saveAsChangeRequest,
          onSubmit: () => onSubmit(false),
        }}
        dropdownPosition={dropdownPosition}
        hint={messages.common.mergeImmediatelyHint}
        immediateAction={{ label: messages.nodeDetail.save, onSubmit: () => onSubmit(true) }}
        onMenuCloseAutoFocus={onMenuCloseAutoFocus}
      />
    </div>
  );
}

/** The validation message under an in-cell editor. */
function InlineCellEditorError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p
      className="truncate text-[10px] text-destructive leading-3"
      id={id}
      role="alert"
      title={message}
    >
      {message}
    </p>
  );
}

/**
 * Relation selection keeps its local draft open long enough to choose several
 * records, then uses the same permission-aware save action as every other
 * inline editor. The picker is also used by the record form, so searching,
 * paging and missing-record handling stay consistent between both surfaces.
 */
function InlineRelationCellEditor({
  client,
  field,
  grid,
  loadedRecords,
  record,
}: {
  client: BusabaseDashboardApiClient;
  field: BaseFieldVO;
  grid: BaseGridEditing;
  loadedRecords: RecordVO[];
  record: RecordVO;
}) {
  const copy = useInlineCellEditMessages();
  const resolveIString = useIString();
  const fieldName = resolveIString(field.name);
  const key = gridCellKey(record.id, field.slug);
  const [draft, setDraft] = useState<string[]>(() => {
    const current = getEditorFieldValue(field, grid.getDisplayValue(record, field));
    return Array.isArray(current)
      ? current.filter((item): item is string => typeof item === "string")
      : typeof current === "string" && current
        ? [current]
        : [];
  });
  const latest = useRef(draft);
  const settled = useRef(false);
  const error = grid.editError ? describeInlineCellError(copy, grid.editError, fieldName) : null;
  const change = (next: unknown) => {
    const relationIds = Array.isArray(next)
      ? next.filter((item): item is string => typeof item === "string")
      : typeof next === "string" && next
        ? [next]
        : [];
    latest.current = relationIds;
    setDraft(relationIds);
  };
  const settle = (action: () => boolean) => {
    if (!settled.current) settled.current = action();
    return settled.current;
  };

  return (
    <div className="relative min-w-0 flex-1 py-1" data-inline-cell-editor={field.slug}>
      <RelationFieldEditor
        addButtonFirst
        autoOpen
        client={client}
        field={field}
        fieldName={fieldName}
        footer={
          <>
            {error ? (
              <p className="mb-2 text-destructive text-xs" role="alert">
                {error}
              </p>
            ) : null}
            <InlineCellSubmitActions
              dropdownPosition="below"
              onCancel={() =>
                settle(() => {
                  grid.cancelEditing("stay");
                  return true;
                })
              }
              onSubmit={(mergeImmediately) =>
                settle(() => grid.commit(record, field, latest.current, "stay", mergeImmediately))
              }
            />
          </>
        }
        inputId={`${key}-inline-relation`}
        loadedRecords={loadedRecords}
        onChange={change}
        onEscape={() =>
          settle(() => {
            grid.cancelEditing("stay");
            return true;
          })
        }
        onOpenChange={(open) => {
          if (!open) return settle(() => grid.commit(record, field, latest.current, "none"));
        }}
        value={draft}
      />
    </div>
  );
}

/**
 * Text uses a compact textarea so existing line breaks survive an edit. Number,
 * URL, email and phone use a text input with the matching on-screen keyboard:
 * number/email inputs cannot place the caret and refuse formatted prices.
 */
function InlineTextCellEditor({
  field,
  grid,
  kind,
  record,
}: {
  field: BaseFieldVO;
  grid: BaseGridEditing;
  kind: InlineCellEditorKind;
  record: RecordVO;
}) {
  const copy = useInlineCellEditMessages();
  const resolveIString = useIString();
  const fieldName = resolveIString(field.name);
  const key = gridCellKey(record.id, field.slug);
  const session = grid.editing?.session;
  const seeded = grid.editing?.seed != null;
  const [draft, setDraft] = useState(() =>
    grid.draftRef.current?.key === key
      ? grid.draftRef.current.value
      : toInlineCellDraft(field, grid.getDisplayValue(record, field)),
  );
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const alive = useAliveRef();
  const latestGrid = useRef(grid);
  latestGrid.current = grid;
  const leaveTimer = useRef<number | null>(null);
  const errorId = `${key}-inline-error`;
  const error = grid.editError ? describeInlineCellError(copy, grid.editError, fieldName) : null;

  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once per editing session.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    if (seeded) {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    } else {
      input.select();
    }
  }, [session]);

  const submit = (move: GridMove, mergeImmediately?: boolean) =>
    grid.commit(record, field, draft, move, mergeImmediately);
  // Focus moving into the submit bar or its menu — portals, but React children
  // of this editor — is not leaving it. Focus going anywhere else saves, as
  // before; the check waits a tick for the focus that follows the blur.
  const stayInEditor = () => {
    if (leaveTimer.current === null) return;
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  };
  const leaveEditor = () => {
    stayInEditor();
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null;
      if (!alive.current || latestGrid.current.editing?.session !== session) return;
      submit("none");
    }, 0);
  };
  const inputProps = {
    "aria-describedby": error ? errorId : undefined,
    "aria-invalid": error ? true : undefined,
    "aria-label": fieldName,
    className: `h-7 w-full min-w-0 rounded border bg-background px-1.5 text-foreground text-sm outline-none ${
      error ? "border-destructive" : "border-primary"
    }`,
    inputMode: INPUT_MODE[kind],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next =
        kind === "text"
          ? preserveInlineTextLineEndings(draft, event.target.value)
          : event.target.value;
      setDraft(next);
      grid.updateDraft(key, next);
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      event.stopPropagation();
      if (isComposing(event)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        submit("stay");
      } else if (event.key === "Escape") {
        event.preventDefault();
        grid.cancelEditing("stay");
      } else if (event.key === "Tab") {
        event.preventDefault();
        submit(event.shiftKey ? "previous" : "next");
      }
    },
    ref: (input: HTMLInputElement | HTMLTextAreaElement | null) => {
      inputRef.current = input;
    },
    value: draft,
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focusin/focusout only track whether focus is still inside the editor; the input is the interactive element.
    <div
      className="relative flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-1"
      data-inline-cell-editor={field.slug}
      onBlur={leaveEditor}
      onFocus={stayInEditor}
    >
      {kind === "text" ? (
        <textarea
          {...inputProps}
          className={`${inputProps.className} resize-none overflow-y-auto py-0.5 leading-5`}
          rows={1}
          wrap="off"
        />
      ) : (
        <input {...inputProps} type="text" />
      )}
      <InlineCellEditorError id={errorId} message={error} />
      <Popover open>
        <PopoverTrigger asChild>
          <span aria-hidden className="pointer-events-none absolute inset-0" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={fieldName}
          className="w-auto p-1.5"
          collisionPadding={8}
          data-inline-cell-editor={field.slug}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            // The input handles its own Esc; this one is for focus left in the bar.
            event.preventDefault();
            if (document.activeElement !== inputRef.current) grid.cancelEditing("stay");
          }}
          // A click on the bar keeps focus (and the caret) in the input.
          onMouseDown={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          side="bottom"
          sideOffset={4}
        >
          <InlineCellSubmitActions
            dropdownPosition="below"
            onCancel={() => grid.cancelEditing("stay")}
            onMenuCloseAutoFocus={(event) => {
              event.preventDefault();
              inputRef.current?.focus({ preventScroll: true });
            }}
            onSubmit={(mergeImmediately) => submit("stay", mergeImmediately)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * A single select: the record form's option panel (`ChoiceOptionsPanel`) in a
 * popover anchored to the cell. A pick saves; Esc or clicking away cancels;
 * Tab cancels and moves on.
 */
function InlineSelectCellEditor({
  field,
  grid,
  record,
}: {
  field: BaseFieldVO;
  grid: BaseGridEditing;
  record: RecordVO;
}) {
  const resolveIString = useIString();
  const fieldName = resolveIString(field.name);
  const key = gridCellKey(record.id, field.slug);
  const value = grid.getDisplayValue(record, field);
  const chips = getFieldChipEntries(field, value);
  const inputRef = useRef<HTMLInputElement>(null);
  // Type-to-edit: the keys typed so far (even before the panel mounted) are the search.
  const [initialQuery] = useState(() =>
    grid.editing?.seed != null && grid.draftRef.current?.key === key
      ? grid.draftRef.current.value
      : "",
  );

  return (
    <div
      className="relative flex h-full min-w-0 flex-1 items-center"
      data-inline-cell-editor={field.slug}
    >
      {chips[0] ? <FieldBadge chip={chips[0]} /> : <span className="text-muted-foreground">-</span>}
      <Popover
        onOpenChange={(open) => {
          if (!open) grid.cancelEditing("none");
        }}
        open
      >
        <PopoverTrigger asChild>
          <span aria-hidden className="absolute inset-0" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={fieldName}
          className={choicePopoverClassName}
          collisionPadding={16}
          data-inline-cell-editor={field.slug}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            grid.cancelEditing("stay");
          }}
          onKeyDown={(event) => {
            // The panel handles its own keys first; the grid only adds Tab.
            event.stopPropagation();
            if (event.key === "Tab") {
              event.preventDefault();
              grid.cancelEditing(event.shiftKey ? "previous" : "next");
            }
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          sideOffset={2}
        >
          <ChoiceOptionsPanel
            field={field}
            fieldName={fieldName}
            initialQuery={initialQuery}
            inputId={`${key}-inline`}
            onChange={(next) => grid.commit(record, field, next, "stay")}
            searchInputRef={inputRef}
            value={value}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * A date: the record form's date control (`DateFieldInput` — the localized
 * calendar, plus the 24-hour time box in the field's zone) with its calendar
 * opened from the cell. A day field saves on the pick, as one pick is the
 * whole edit; a time-of-day field saves when the calendar closes, so the time
 * can be set after the day, or from the submit control under the calendar.
 * Esc cancels either.
 */
function InlineDateCellEditor({
  field,
  grid,
  record,
}: {
  field: BaseFieldVO;
  grid: BaseGridEditing;
  record: RecordVO;
}) {
  const copy = useInlineCellEditMessages();
  const resolveIString = useIString();
  const fieldName = resolveIString(field.name);
  const key = gridCellKey(record.id, field.slug);
  const options = getDateFieldOptions(field.options);
  const [draft, setDraft] = useState<unknown>(() => grid.getDisplayValue(record, field));
  const latest = useRef(draft);
  // Once saved or cancelled, the picker's own trailing close is not a second save.
  const settled = useRef(false);
  const settle = (action: () => boolean) => {
    if (settled.current) return;
    // A refused value (clearing a required date) keeps the editor open.
    settled.current = action();
  };
  const errorId = `${key}-inline-error`;
  const error = grid.editError ? describeInlineCellError(copy, grid.editError, fieldName) : null;

  return (
    <div
      className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-1"
      data-inline-cell-editor={field.slug}
    >
      <DateFieldInput
        ariaDescribedBy={error ? errorId : undefined}
        ariaLabel={fieldName}
        className={`h-7 w-full min-w-0 rounded border bg-background px-1.5 text-foreground text-sm outline-none ${
          error ? "border-destructive" : "border-primary"
        }`}
        id={`${key}-inline-date`}
        onChange={(next) => {
          latest.current = next;
          setDraft(next);
          if (!options.includeTime) settle(() => grid.commit(record, field, next, "stay"));
        }}
        options={options}
        popover={{
          open: true,
          footer: options.includeTime ? (
            <InlineCellSubmitActions
              onCancel={() =>
                settle(() => {
                  grid.cancelEditing("stay");
                  return true;
                })
              }
              onSubmit={(mergeImmediately) =>
                settle(() => grid.commit(record, field, latest.current, "stay", mergeImmediately))
              }
            />
          ) : undefined,
          onOpenChange: (open) => {
            if (!open) settle(() => grid.commit(record, field, latest.current, "none"));
          },
          onEscapeKeyDown: (event) => {
            event.preventDefault();
            settle(() => {
              grid.cancelEditing("stay");
              return true;
            });
          },
          onCloseAutoFocus: (event) => event.preventDefault(),
        }}
        timeZoneHintPlacement="calendar"
        value={draft}
      />
      <InlineCellEditorError id={errorId} message={error} />
    </div>
  );
}
