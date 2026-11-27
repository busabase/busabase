import { getRecordFindFieldSupport } from "busabase-contract/domains/base/contract/record-find";
import type { BaseFieldVO } from "busabase-contract/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { ListFilter, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useCoreLocale, useIString } from "../../../i18n";
import { recordFindMessages } from "../../../i18n/record-find";
import { RECORD_FIND_QUERY_LIMIT } from "../helpers/record-find-url";
import type { RecordFindControl } from "../hooks/use-record-find";
import {
  RECORD_FIND_KEY_SHORTCUTS,
  useRecordFindShortcut,
} from "../hooks/use-record-find-shortcut";
import { ACTIVE_VIEW_CONTROL_CLASS_NAME } from "./view-control-styles";

/** The field menu renders in a portal, outside the find box's DOM subtree. */
const isInFieldMenu = (node: EventTarget | null): boolean =>
  node instanceof Element && Boolean(node.closest("[data-record-find-field-menu]"));

export function RecordFind({
  control,
  fields,
  visibleSlugs,
}: {
  control: RecordFindControl;
  fields: BaseFieldVO[];
  visibleSlugs: string[];
}) {
  const messages = recordFindMessages[useCoreLocale()];
  const resolveIString = useIString();
  const hintId = useId();
  const fieldHintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // A narrow toolbar (below 480px — a phone) has no room for the input and its
  // buttons beside the view's icon buttons; inline, the input was down to a few
  // letters. There it collapses to one more icon and opens over the whole row
  // on tap, so the toolbar keeps its single row (the table loses no height)
  // and the find gets the full width while in use. Leaving it folds it back
  // WITHOUT clearing — Fields / Filter / Sort under it stay reachable while a
  // find is active — and the icon then shows the active state, so a filtered
  // table never hides why. Its close button clears and folds. Wider toolbars,
  // and places outside the view toolbar's container, never match these
  // container queries and keep the inline find as before.
  const [open, setOpen] = useState(false);
  // Cmd/Ctrl+F selects the query so typing replaces it; a tap on the folded
  // icon only focuses.
  const selectOnOpen = useRef(false);
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (selectOnOpen.current) inputRef.current?.select();
    selectOnOpen.current = false;
  }, [open]);
  const focusInput = (select = false) => {
    inputRef.current?.focus();
    if (select) inputRef.current?.select();
  };
  useRecordFindShortcut(inputRef, () => {
    // A folded narrow find has no visible input yet: open it, then focus.
    if (!open) {
      selectOnOpen.current = true;
      setOpen(true);
    }
    focusInput(true);
  });
  // The field menu lives in a portal, so focus moving into it leaves this box.
  // While it is open (and as it closes) that must not fold a narrow find.
  const menuOpen = useRef(false);
  // Choosing a field hands focus back to the input; Escape returns it to the
  // menu button as usual.
  const focusInputAfterMenu = useRef(false);
  const active = control.query !== "";
  const loading = control.isPending || control.isFetching;
  const selectedField = control.fieldId
    ? fields.find((field) => field.id === control.fieldId)
    : undefined;
  const chipLabel = selectedField ? resolveIString(selectedField.name) : messages.removed;
  const visible = new Set(visibleSlugs);
  const fieldsBySlug = new Map(fields.map((field) => [field.slug, field]));
  const orderedFields = [
    ...[...visible].flatMap((slug) => {
      const field = fieldsBySlug.get(slug);
      return field ? [field] : [];
    }),
    ...fields.filter((field) => !visible.has(field.slug)),
  ];
  return (
    <>
      <button
        aria-label={active ? `${messages.label}: ${control.query}` : messages.label}
        className={`ml-auto hidden size-7 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-accent hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11 ${
          active ? ACTIVE_VIEW_CONTROL_CLASS_NAME : "border-border/70 bg-card text-muted-foreground"
        } ${open ? "" : "@max-[480px]/view-controls:inline-flex"}`}
        data-testid="base-record-find-open"
        onClick={() => setOpen(true)}
        title={active ? `${messages.label}: ${control.query}` : messages.label}
        type="button"
      >
        <Search aria-hidden className="size-3.5" />
      </button>
      <div
        aria-label={messages.label}
        className={`@container/record-find ml-auto flex h-7 min-w-0 max-w-64 flex-1 items-center rounded-md border border-border/70 bg-card focus-within:ring-1 focus-within:ring-ring @min-[640px]/view-controls:w-64 @min-[640px]/view-controls:max-w-[60%] @min-[640px]/view-controls:flex-none [@media(pointer:coarse)]:h-11 ${
          open
            ? "@max-[480px]/view-controls:absolute @max-[480px]/view-controls:inset-x-0 @max-[480px]/view-controls:top-0 @max-[480px]/view-controls:z-10 @max-[480px]/view-controls:max-w-none"
            : "@max-[480px]/view-controls:hidden"
        }`}
        data-testid="base-record-find"
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          if (menuOpen.current || isInFieldMenu(event.relatedTarget) || isInFieldMenu(event.target))
            return;
          setOpen(false);
        }}
        role="search"
      >
        {loading ? (
          <LoaderCircle
            aria-hidden
            className="ml-2 hidden size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none @min-[160px]/record-find:block"
          />
        ) : (
          <Search
            aria-hidden
            className="ml-2 hidden size-3 shrink-0 text-muted-foreground @min-[160px]/record-find:block"
          />
        )}
        {control.fieldId ? (
          <span
            className="ml-1.5 inline-flex h-5 min-w-0 max-w-[45%] shrink items-center gap-1 rounded bg-muted pr-0.5 pl-1.5 text-foreground text-xs [@media(pointer:coarse)]:h-7"
            data-testid="base-record-find-field-chip"
            title={selectedField ? `${messages.inField} ${chipLabel}` : chipLabel}
          >
            {selectedField ? (
              <span className="shrink-0 text-muted-foreground @max-[200px]/record-find:hidden">
                {messages.inField}
              </span>
            ) : null}
            <span className="min-w-0 truncate">{chipLabel}</span>
            <button
              aria-label={messages.searchVisibleFields}
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [@media(pointer:coarse)]:size-6"
              data-testid="base-record-find-field-chip-clear"
              onClick={() => {
                // Focus first: the chip unmounts with the choice it shows.
                focusInput();
                control.setFieldId("");
              }}
              title={messages.searchVisibleFields}
              type="button"
            >
              <X aria-hidden size={10} />
            </button>
          </span>
        ) : null}
        <input
          aria-describedby={hintId}
          aria-keyshortcuts={RECORD_FIND_KEY_SHORTCUTS}
          aria-label={messages.label}
          className="h-full min-w-12 flex-1 bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground [@media(pointer:coarse)]:text-base [&::-webkit-search-cancel-button]:appearance-none"
          data-testid="base-record-find-input"
          maxLength={RECORD_FIND_QUERY_LIMIT}
          onChange={(event) => control.setQuery(event.currentTarget.value)}
          onCompositionEnd={(event) => control.endComposition(event.currentTarget.value)}
          onCompositionStart={control.startComposition}
          onKeyDown={(event) => {
            // Return / the keyboard's Search key folds a narrow find back to
            // its icon, keeping the query (no-op on a wide toolbar). Not while
            // an IME is still composing — Return there commits the candidate.
            if (event.key === "Enter" && !event.nativeEvent.isComposing) setOpen(false);
          }}
          placeholder={messages.placeholder}
          ref={inputRef}
          type="search"
          value={control.query}
        />
        {control.query ? (
          <button
            aria-label={messages.clear}
            className="mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring @max-[480px]/view-controls:hidden [@media(pointer:coarse)]:mr-0"
            data-testid="base-record-find-clear"
            onClick={() => {
              control.clear();
              inputRef.current?.focus();
            }}
            type="button"
          >
            <X aria-hidden size={12} />
          </button>
        ) : null}
        <DropdownMenu
          onOpenChange={(next) => {
            menuOpen.current = next;
          }}
        >
          <DropdownMenuTrigger
            aria-describedby={fieldHintId}
            aria-label={messages.field}
            className="mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground [@media(pointer:coarse)]:mr-0 [@media(pointer:coarse)]:size-11"
            data-testid="base-record-find-field-trigger"
            title={messages.field}
            type="button"
          >
            <ListFilter aria-hidden size={13} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-64 max-w-[calc(100vw-1rem)]"
            data-record-find-field-menu=""
            onCloseAutoFocus={(event) => {
              if (!focusInputAfterMenu.current) return;
              focusInputAfterMenu.current = false;
              event.preventDefault();
              focusInput();
            }}
          >
            <DropdownMenuRadioGroup
              onValueChange={(fieldId) => {
                focusInputAfterMenu.current = true;
                control.setFieldId(fieldId);
              }}
              value={control.fieldId}
            >
              <DropdownMenuRadioItem
                data-field-id=""
                data-testid="base-record-find-field-option"
                value=""
              >
                {messages.visibleFields}
              </DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {orderedFields.map((field) => {
                const support = getRecordFindFieldSupport(field);
                const detail = [
                  visible.has(field.slug) ? "" : messages.hidden,
                  support.reason ? messages[support.reason] : "",
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <DropdownMenuRadioItem
                    data-field-id={field.id}
                    data-testid="base-record-find-field-option"
                    disabled={!support.supported}
                    key={field.id}
                    value={field.id}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{resolveIString(field.name)}</span>
                      {detail ? (
                        <span className="block text-muted-foreground text-xs"> {detail}</span>
                      ) : null}
                    </span>
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-muted-foreground text-xs">{messages.hiddenHint}</p>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="sr-only" id={fieldHintId}>
          {messages.hiddenHint}
        </span>
        {/* Narrow toolbar only: clear the find and fold it back to its icon. */}
        <button
          aria-label={messages.close}
          className="mr-1 hidden size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring @max-[480px]/view-controls:inline-flex [@media(pointer:coarse)]:mr-0 [@media(pointer:coarse)]:size-11"
          data-testid="base-record-find-close"
          title={messages.close}
          onClick={() => {
            control.clear();
            setOpen(false);
          }}
          type="button"
        >
          <X aria-hidden size={14} />
        </button>
        <span aria-live="polite" className="sr-only" id={hintId}>
          {loading ? messages.searching : ""}
        </span>
      </div>
    </>
  );
}
