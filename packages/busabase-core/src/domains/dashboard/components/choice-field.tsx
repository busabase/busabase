"use client";

import type { BaseFieldVO } from "busabase-contract/types";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "kui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fmt, useCoreLocale } from "../../../i18n";
import { choiceFieldMessages } from "../../../i18n/choice-field";
import { getChoiceBadgeClass } from "../helpers/field";

type Choice = NonNullable<BaseFieldVO["options"]["choices"]>[number];
type SelectedChoice = { raw: string; choice?: Choice; issue?: "unavailable" | "ambiguous" };

// IDs are authoritative. A historical name resolves only if it identifies one option.
function resolveChoice(raw: string, choices: readonly Choice[]): SelectedChoice {
  const byId = choices.find((choice) => choice.id === raw);
  if (byId) return { raw, choice: byId };
  const byName = choices.filter((choice) => choice.name === raw);
  return byName.length === 1
    ? { raw, choice: byName[0] }
    : { raw, issue: byName.length > 1 ? "ambiguous" : "unavailable" };
}

/** Controlled record draft editor: closing/searching never writes or clears a record. */
export function ChoiceFieldEditor({
  ariaDescribedBy,
  field,
  fieldName,
  inputId,
  onChange,
  value,
}: {
  ariaDescribedBy?: string;
  field: BaseFieldVO;
  fieldName: string;
  inputId: string;
  onChange: (value: unknown) => void;
  value: unknown;
}) {
  const copy = choiceFieldMessages[useCoreLocale()];
  const multiple = field.type === "multiselect";
  const choices = field.options.choices ?? [];
  const rawValues = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : typeof value === "string" && value
      ? [value]
      : [];
  const selected = rawValues.map((raw) => resolveChoice(raw, choices));
  const selectedIds = new Set(selected.flatMap((item) => (item.choice ? [item.choice.id] : [])));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number>();
  const [viewportBottom, setViewportBottom] = useState(0);
  const [collapse, setCollapse] = useState({ count: rawValues.length, height: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const search = query.trim().toLocaleLowerCase();
  const candidates = choices.filter((choice) => choice.name.toLocaleLowerCase().includes(search));
  const activeChoice = candidates[Math.min(activeIndex, candidates.length - 1)];
  const activeId = activeChoice ? `${inputId}-choice-${activeChoice.id}` : undefined;
  const listId = `${inputId}-choices`;

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 639px)");
    const update = () => {
      setMobile(media?.matches ?? false);
      setViewportHeight(window.visualViewport?.height ?? window.innerHeight);
      setViewportBottom(
        Math.max(
          0,
          window.innerHeight -
            (window.visualViewport?.height ?? window.innerHeight) -
            (window.visualViewport?.offsetTop ?? 0),
        ),
      );
    };
    update();
    media?.addEventListener("change", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      media?.removeEventListener("change", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);

  // Measure the actual wrapping, rather than hiding an arbitrary number of tags.
  // biome-ignore lint/correctness/useExhaustiveDependencies: value and options change the measured DOM children.
  useLayoutEffect(() => {
    const chips = chipsRef.current;
    if (!chips || !multiple) return;
    const measure = () => {
      const items = Array.from(chips.children) as HTMLElement[];
      const rows = [...new Set(items.map((item) => item.offsetTop))].sort((a, b) => a - b);
      const secondRow = rows[1] ?? rows[0] ?? 0;
      const visible = items.filter((item) => item.offsetTop <= secondRow);
      setCollapse({
        count: visible.length,
        height: Math.max(
          0,
          ...visible.map((item) => item.offsetTop - (rows[0] ?? 0) + item.offsetHeight),
        ),
      });
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(chips);
    return () => observer?.disconnect();
  }, [multiple, value, field.options.choices]);

  useEffect(() => {
    if (open && activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId, open]);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      const index = choices.findIndex((choice) => selectedIds.has(choice.id));
      setActiveIndex(Math.max(0, index));
    }
  };
  const choose = (choice: Choice) => {
    if (!multiple) {
      onChange(choice.id);
      setOpen(false);
      return;
    }
    const next = selectedIds.has(choice.id)
      ? selected.filter((item) => item.choice?.id !== choice.id)
      : [...selected, { raw: choice.id, choice }];
    onChange([...new Set(next.map((item) => item.choice?.id ?? item.raw))]);
  };
  const remove = (index: number) => {
    onChange(multiple ? rawValues.filter((_, itemIndex) => itemIndex !== index) : "");
    triggerRef.current?.focus();
  };
  const navigate = (event: KeyboardEvent<HTMLElement>, fromSearch: boolean) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    if (event.key === "Enter" || (!fromSearch && event.key === " ")) {
      event.preventDefault();
      if (activeChoice) choose(activeChoice);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      // Home/End retain their normal text-editing meaning in the search box.
      if (fromSearch && (event.key === "Home" || event.key === "End")) return;
      event.preventDefault();
      if (fromSearch && multiple) {
        listRef.current?.focus();
        return;
      }
      setActiveIndex((index) =>
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? Math.max(0, candidates.length - 1)
            : Math.max(
                0,
                Math.min(candidates.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
              ),
      );
    }
  };
  const clear = () => {
    onChange(multiple ? [] : "");
    inputRef.current?.focus();
  };
  const badge = (item: SelectedChoice) => (
    <span
      className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${item.issue ? "border-destructive/50 bg-destructive/5 text-destructive" : getChoiceBadgeClass(item.choice?.color)}`}
    >
      <span className="truncate">{item.choice?.name ?? item.raw}</span>
      {item.issue ? <span className="shrink-0">({copy[item.issue]})</span> : null}
    </span>
  );
  const placeholder = multiple ? copy.selectMultiple : copy.select;
  const trigger = (
    <button
      aria-describedby={[ariaDescribedBy, `${inputId}-selection`].filter(Boolean).join(" ")}
      aria-label={fieldName}
      className="absolute inset-0 flex w-full items-center justify-end rounded-md pr-2.5 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
      id={inputId}
      ref={triggerRef}
      type="button"
    >
      <ChevronDown aria-hidden className="size-4" />
    </button>
  );
  const content = (
    <>
      {mobile ? (
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
          <DialogTitle className="text-sm">{fieldName}</DialogTitle>
          <button
            className="min-h-11 rounded px-3 text-primary text-sm"
            onClick={() => setOpen(false)}
            type="button"
          >
            {copy.done}
          </button>
        </div>
      ) : null}
      <div className="flex shrink-0 items-center gap-2 border-b px-3">
        <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <input
          {...(!multiple
            ? ({
                role: "combobox",
                "aria-expanded": true,
                "aria-autocomplete": "list",
                "aria-activedescendant": activeId,
              } as const)
            : {})}
          aria-controls={listId}
          aria-label={`${copy.search} — ${fieldName}`}
          className="h-11 w-full min-w-0 bg-transparent text-base outline-none sm:text-sm"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onKeyDown={(event) => navigate(event, true)}
          placeholder={copy.search}
          ref={inputRef}
          type="text"
          value={query}
        />
        {query ? (
          <button
            aria-label={copy.clearSearch}
            className="grid min-h-9 min-w-9 place-items-center rounded hover:bg-accent max-sm:min-h-11 max-sm:min-w-11"
            onClick={() => {
              setQuery("");
              setActiveIndex(0);
              inputRef.current?.focus();
            }}
            type="button"
          >
            <X aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>
      <div
        aria-activedescendant={multiple ? activeId : undefined}
        aria-label={fieldName}
        aria-multiselectable={multiple || undefined}
        className="min-h-0 max-h-80 overflow-y-auto overscroll-contain p-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        id={listId}
        onKeyDown={(event) => navigate(event, false)}
        ref={listRef}
        role="listbox"
        tabIndex={multiple ? 0 : -1}
      >
        {candidates.map((choice, index) => {
          const checked = selectedIds.has(choice.id);
          const duplicateName = choices.some(
            (other) => other.id !== choice.id && other.name === choice.name,
          );
          return (
            <div
              aria-label={duplicateName ? `${choice.name} — ${choice.id}` : choice.name}
              aria-selected={checked}
              className={`flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm max-sm:min-h-11 ${activeChoice?.id === choice.id ? "bg-accent" : "hover:bg-accent/60"}`}
              data-option-id={choice.id}
              id={`${inputId}-choice-${choice.id}`}
              key={choice.id}
              onClick={() => choose(choice)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActiveIndex(index)}
              role="option"
              tabIndex={-1}
              title={choice.name}
            >
              <span
                aria-hidden
                className={`grid size-4 shrink-0 place-items-center border ${multiple ? "rounded" : "rounded-full"} ${checked ? "border-primary text-primary" : "border-muted-foreground/50"}`}
              >
                {checked ? (
                  multiple ? (
                    <Check className="size-3.5" />
                  ) : (
                    <span className="size-2 rounded-full bg-current" />
                  )
                ) : null}
              </span>
              <span
                className={`min-w-0 truncate rounded border px-1.5 py-0.5 text-xs ${getChoiceBadgeClass(choice.color)}`}
              >
                {choice.name}
              </span>
              {duplicateName ? (
                <span className="ml-auto truncate font-mono text-muted-foreground text-xs">
                  {choice.id}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {candidates.length === 0 ? (
        <p className="px-3 py-5 text-center text-muted-foreground text-sm" role="status">
          {choices.length === 0 ? copy.noOptions : copy.noMatches}
        </p>
      ) : null}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2 text-muted-foreground text-xs">
        <span aria-live="polite">{fmt(copy.selected, { count: rawValues.length })}</span>
        {rawValues.length > 0 && (multiple || !field.required) ? (
          <button
            className="min-h-8 rounded px-2 hover:bg-accent hover:text-foreground max-sm:min-h-11"
            onClick={clear}
            type="button"
          >
            {copy.clearSelection}
          </button>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="min-w-0" data-choice-field-editor={field.slug}>
      <span className="sr-only" id={`${inputId}-selection`}>
        {selected.length > 0
          ? `${fmt(copy.selected, { count: selected.length })}: ${selected.map((item) => `${item.choice?.name ?? item.raw}${item.issue ? ` (${copy[item.issue]})` : ""}`).join(", ")}`
          : placeholder}
      </span>
      <div className="relative min-h-9 rounded-md border border-border/70 bg-card p-1.5 pr-9">
        {multiple && selected.length > 0 ? (
          <div
            className="pointer-events-none relative z-10 flex flex-wrap items-center gap-1.5 overflow-hidden"
            ref={chipsRef}
            style={!expanded && collapse.height > 0 ? { maxHeight: collapse.height } : undefined}
          >
            {selected.map((item, index) => {
              const hidden = !expanded && index >= collapse.count;
              const label = item.choice?.name ?? item.raw;
              return (
                <span
                  aria-hidden={hidden || undefined}
                  className="inline-flex h-7 min-w-0 max-w-full items-center gap-1 max-sm:h-11"
                  data-choice-id={item.choice?.id ?? item.raw}
                  key={`${item.raw}-${index}`}
                  title={label}
                >
                  {badge(item)}
                  <button
                    aria-label={fmt(copy.remove, { name: label })}
                    className="pointer-events-auto grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent focus-visible:outline-primary max-sm:size-11"
                    onClick={() => remove(index)}
                    tabIndex={hidden ? -1 : undefined}
                    type="button"
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                </span>
              );
            })}
          </div>
        ) : (
          <div className="pointer-events-none relative z-10 flex min-h-5 min-w-0 items-center text-sm">
            {selected[0] ? (
              badge(selected[0])
            ) : (
              <span className="truncate text-muted-foreground">{placeholder}</span>
            )}
          </div>
        )}
        {mobile ? (
          <Dialog onOpenChange={changeOpen} open={open}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent
              aria-describedby={undefined}
              className="flex flex-col gap-0 overflow-hidden rounded-t-xl p-0"
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                inputRef.current?.focus();
              }}
              showCloseButton={false}
              style={{
                bottom: viewportBottom,
                left: 0,
                top: "auto",
                transform: "none",
                translate: "none",
                maxWidth: "none",
                maxHeight: viewportHeight ? Math.min(viewportHeight * 0.85, 560) : "85dvh",
                paddingBottom: "env(safe-area-inset-bottom)",
              }}
            >
              {content}
            </DialogContent>
          </Dialog>
        ) : (
          <Popover onOpenChange={changeOpen} open={open}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent
              align="start"
              aria-label={fieldName}
              className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(480px,var(--radix-popover-trigger-width))] min-w-[min(280px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0"
              collisionPadding={16}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                inputRef.current?.focus();
              }}
            >
              {content}
            </PopoverContent>
          </Popover>
        )}
      </div>
      {multiple && collapse.count < selected.length ? (
        <button
          aria-expanded={expanded}
          className="mt-1 rounded px-1 py-1 text-muted-foreground text-xs hover:text-foreground"
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          {expanded ? copy.less : fmt(copy.more, { count: selected.length - collapse.count })}
        </button>
      ) : null}
    </div>
  );
}
