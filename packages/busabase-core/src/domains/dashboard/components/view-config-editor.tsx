import type {
  BaseFieldVO,
  FieldType,
  ViewConfigVO,
  ViewFilterOperator,
  ViewVO,
} from "busabase-contract/types";
import { Dialog, DialogContent, DialogTitle } from "kui/dialog";
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  AtSign,
  Braces,
  CalendarDays,
  CircleDot,
  Code2,
  Columns3,
  EyeOff,
  FileText,
  Filter,
  GitBranch,
  Hash,
  Link2,
  ListChecks,
  ListOrdered,
  ListTree,
  type LucideIcon,
  MonitorPlay,
  Paperclip,
  Phone,
  Plus,
  RotateCcw,
  Sparkles,
  SquareCheck,
  Trash2,
  Type,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { fmt, useCoreI18n, useIString } from "../../../i18n";
import {
  addViewFilter,
  addViewSort,
  clearAllViewFilters,
  clearAllViewSorts,
  clearViewFilterAt,
  clearViewSortAt,
  getVisibleViewFieldSlugs,
  hideViewField,
  matchesViewField,
  moveViewField,
  moveViewSort,
  resetAllViewFieldWidths,
  resetViewFieldWidth,
  showAllViewFields,
  showViewField,
  updateViewFilterAt,
  updateViewSortAt,
} from "../helpers/view-config";
import type { ViewSubmitOptions } from "../helpers/view-types";
import { SplitSubmitButton } from "./split-submit-button";

export type ViewConfigEditorSection = "fields" | "filters" | "sorts";
export type ViewConfigEditorSource = "header" | "toolbar";

export interface ViewConfigEditorRequest {
  focusedFieldId?: string;
  section: ViewConfigEditorSection;
  source: ViewConfigEditorSource;
}

export const FIELD_TYPE_ICONS: Record<FieldType, LucideIcon> = {
  text: Type,
  longtext: AlignLeft,
  markdown: FileText,
  html: Code2,
  code: Code2,
  json: Braces,
  yaml: ListTree,
  number: Hash,
  checkbox: SquareCheck,
  date: CalendarDays,
  email: AtSign,
  url: Link2,
  embed: MonitorPlay,
  phone: Phone,
  select: CircleDot,
  multiselect: ListChecks,
  relation: GitBranch,
  attachment: Paperclip,
  ai_summary: Sparkles,
  ai_tags: Sparkles,
  created_time: CalendarDays,
  updated_time: CalendarDays,
  created_by: UserRound,
  updated_by: UserRound,
  auto_number: ListOrdered,
};

const FILTER_OPERATORS_BY_KIND = {
  checkbox: ["is_true", "is_false", "is_empty", "not_empty"],
  emptyOnly: ["is_empty", "not_empty"],
  value: ["contains", "equals", "is_empty", "not_empty"],
} as const satisfies Record<string, readonly ViewFilterOperator[]>;

export const getFieldFilterOperators = (type: FieldType): readonly ViewFilterOperator[] => {
  if (type === "checkbox") {
    return FILTER_OPERATORS_BY_KIND.checkbox;
  }
  if (type === "attachment" || type === "relation") {
    return FILTER_OPERATORS_BY_KIND.emptyOnly;
  }
  return FILTER_OPERATORS_BY_KIND.value;
};

export const viewFilterOperatorNeedsValue = (operator: ViewFilterOperator) =>
  operator === "contains" || operator === "equals";

export function FieldTypeIcon({ field, className }: { field: BaseFieldVO; className?: string }) {
  const Icon = FIELD_TYPE_ICONS[field.type];
  return <Icon aria-hidden="true" className={className} data-field-type-icon={field.type} />;
}

interface ViewConfigToolbarProps {
  config: ViewConfigVO;
  fields: BaseFieldVO[];
  onOpen: (section: ViewConfigEditorSection) => void;
}

export function ViewConfigToolbar({ config, fields, onOpen }: ViewConfigToolbarProps) {
  const messages = useCoreI18n();
  const visible = getVisibleViewFieldSlugs(config, fields);
  const schemaOrder = fields.map((field) => field.slug);
  const customOrder = visible.some((slug, index) => slug !== schemaOrder[index]);
  const widthCount = Object.keys(config.fieldWidths ?? {}).filter((slug) =>
    fields.some((field) => field.slug === slug),
  ).length;
  const items = [
    {
      active: visible.length < fields.length || widthCount > 0 || customOrder,
      count: `${visible.length}/${fields.length}`,
      icon: Columns3,
      label: messages.base.viewFields,
      section: "fields" as const,
    },
    {
      active: config.filters.length > 0,
      count: String(config.filters.length),
      icon: Filter,
      label: messages.base.viewFilters,
      section: "filters" as const,
    },
    {
      active: config.sorts.length > 0,
      count: String(config.sorts.length),
      icon: ArrowUpDown,
      label: messages.base.viewSorts,
      section: "sorts" as const,
    },
  ];

  return (
    <div
      aria-label={messages.base.viewControlsTitle}
      className="mb-3 flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-testid="view-control-toolbar"
      role="toolbar"
    >
      {items.map((item) => (
        <button
          className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 font-medium text-xs transition-colors ${
            item.active
              ? "border-primary/35 bg-primary/10 text-primary hover:bg-primary/15"
              : "border-border/70 bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
          data-testid={`view-control-${item.section}`}
          key={item.section}
          onClick={() => onOpen(item.section)}
          title={`${item.label}: ${item.count}`}
          type="button"
        >
          <item.icon className="size-3.5" />
          <span>{item.label}</span>
          <span className="min-w-4 rounded bg-muted/70 px-1 text-center text-[10px] leading-4 text-muted-foreground">
            {item.count}
          </span>
        </button>
      ))}
    </div>
  );
}

interface ViewFieldsEditorProps {
  config: ViewConfigVO;
  fields: BaseFieldVO[];
  onChange: (config: ViewConfigVO) => void;
  testId: string;
}

export function ViewFieldsEditor({ config, fields, onChange, testId }: ViewFieldsEditorProps) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const visibleSlugs = getVisibleViewFieldSlugs(config, fields);
  const visibleSet = new Set(visibleSlugs);
  const hiddenCount = Math.max(0, fields.length - visibleSlugs.length);
  const widthCount = Object.keys(config.fieldWidths ?? {}).filter((slug) =>
    fields.some((field) => field.slug === slug),
  ).length;
  const orderedFields = [
    ...visibleSlugs
      .map((slug) => fields.find((field) => field.slug === slug))
      .filter((field): field is BaseFieldVO => Boolean(field)),
    ...fields.filter((field) => !visibleSet.has(field.slug)),
  ];

  return (
    <div data-testid={testId}>
      <div className="flex items-center justify-between gap-2 border-border/50 border-b px-3 py-2">
        <span className="text-muted-foreground text-xs">
          {fmt(messages.base.hiddenFieldCount, { count: hiddenCount })}
        </span>
        <div className="flex items-center gap-1">
          <button
            className="h-7 rounded px-2 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            disabled={hiddenCount === 0}
            onClick={() => onChange(showAllViewFields(config, fields))}
            type="button"
          >
            {messages.base.showAllFields}
          </button>
          <button
            className="h-7 rounded px-2 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            disabled={widthCount === 0}
            onClick={() => onChange(resetAllViewFieldWidths(config))}
            type="button"
          >
            {messages.base.resetAllWidths}
          </button>
        </div>
      </div>
      <div className="divide-y divide-border/40">
        {orderedFields.map((field) => {
          const isVisible = visibleSet.has(field.slug);
          const visibleIndex = visibleSlugs.indexOf(field.slug);
          const hasFilter = config.filters.some((filter) => matchesViewField(filter, field));
          const hasSort = config.sorts.some((sort) => matchesViewField(sort, field));
          return (
            <div
              className="flex min-h-10 items-center gap-2 px-3 py-1"
              data-view-field-slug={field.slug}
              key={field.id}
            >
              <input
                aria-label={fmt(messages.base.showFieldAria, { name: resolveIString(field.name) })}
                checked={isVisible}
                disabled={isVisible && visibleSlugs.length <= 1}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? showViewField(config, field, fields)
                      : hideViewField(config, field, fields),
                  )
                }
                type="checkbox"
              />
              <FieldTypeIcon className="size-3.5 shrink-0 text-muted-foreground" field={field} />
              <span className="min-w-0 flex-1 truncate text-xs">{resolveIString(field.name)}</span>
              {!isVisible ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground text-[10px]">
                  <EyeOff className="size-3" />
                  {messages.base.hiddenField}
                </span>
              ) : null}
              {hasFilter ? (
                <Filter
                  aria-label={messages.base.fieldFilterActive}
                  className="size-3.5 shrink-0 text-primary"
                />
              ) : null}
              {hasSort ? (
                <ArrowUpDown
                  aria-label={messages.base.fieldSortActive}
                  className="size-3.5 shrink-0 text-primary"
                />
              ) : null}
              {config.fieldWidths?.[field.slug] !== undefined ? (
                <button
                  aria-label={fmt(messages.base.resetFieldWidthAria, {
                    name: resolveIString(field.name),
                  })}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => onChange(resetViewFieldWidth(config, field.slug))}
                  title={messages.base.resetFieldWidth}
                  type="button"
                >
                  <RotateCcw className="size-3" />
                </button>
              ) : null}
              <div className="flex w-14 shrink-0 items-center justify-end">
                <button
                  aria-label={fmt(messages.base.moveFieldUpAria, {
                    name: resolveIString(field.name),
                  })}
                  className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                  disabled={!isVisible || visibleIndex <= 0}
                  onClick={() => {
                    const target = visibleSlugs[visibleIndex - 1];
                    if (target) {
                      onChange(moveViewField(config, fields, field.slug, target, "before"));
                    }
                  }}
                  title={messages.base.moveFieldUp}
                  type="button"
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  aria-label={fmt(messages.base.moveFieldDownAria, {
                    name: resolveIString(field.name),
                  })}
                  className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                  disabled={!isVisible || visibleIndex >= visibleSlugs.length - 1}
                  onClick={() => {
                    const target = visibleSlugs[visibleIndex + 1];
                    if (target) {
                      onChange(moveViewField(config, fields, field.slug, target, "after"));
                    }
                  }}
                  title={messages.base.moveFieldDown}
                  type="button"
                >
                  <ArrowDown className="size-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ViewConfigEditorDialogProps {
  fields: BaseFieldVO[];
  onClose: () => void;
  onSubmit: (config: ViewConfigVO, options?: ViewSubmitOptions) => Promise<void>;
  request: ViewConfigEditorRequest | null;
  view: ViewVO | null;
}

const withContextCondition = (
  config: ViewConfigVO,
  fields: BaseFieldVO[],
  request: ViewConfigEditorRequest,
) => {
  const field = fields.find((item) => item.id === request.focusedFieldId);
  if (!field) {
    return config;
  }
  if (
    request.section === "filters" &&
    !config.filters.some((item) => matchesViewField(item, field))
  ) {
    return addViewFilter(config, field, getFieldFilterOperators(field.type)[0]);
  }
  if (request.section === "sorts" && !config.sorts.some((item) => matchesViewField(item, field))) {
    return addViewSort(config, field);
  }
  return config;
};

const hasInvalidFilters = (config: ViewConfigVO) =>
  config.filters.some(
    (filter) =>
      viewFilterOperatorNeedsValue(filter.operator) &&
      (filter.value === undefined || filter.value === null || String(filter.value).trim() === ""),
  );

export function ViewConfigEditorDialog({
  fields,
  onClose,
  onSubmit,
  request,
  view,
}: ViewConfigEditorDialogProps) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const [section, setSection] = useState<ViewConfigEditorSection>("fields");
  const [draft, setDraft] = useState<ViewConfigVO>({ filters: [], sorts: [] });
  const [savingMode, setSavingMode] = useState<"request" | "merge" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (request && view) {
      setSection(request.section);
      setDraft(withContextCondition(view.config, fields, request));
      setError(null);
    }
  }, [fields, request, view]);

  useEffect(() => {
    if (!request?.focusedFieldId) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const editor = document.querySelector('[data-testid="shared-view-config-editor"]');
      const control = editor?.querySelector<HTMLElement>('[data-focused-condition="true"] select');
      control?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [request]);

  if (!request || !view) {
    return null;
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(view.config);
  const invalid = hasInvalidFilters(draft);
  const focusedField = fields.find((field) => field.id === request.focusedFieldId);
  const visibleCount = getVisibleViewFieldSlugs(draft, fields).length;

  const submit = async (options?: ViewSubmitOptions) => {
    if (!dirty || invalid || savingMode) {
      return;
    }
    setSavingMode(options?.mergeImmediately ? "merge" : "request");
    setError(null);
    try {
      await onSubmit(draft, options);
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : messages.base.failedQuickViewUpdate,
      );
    } finally {
      setSavingMode(null);
    }
  };

  const discard = () => {
    setDraft(view.config);
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !dirty) {
          onClose();
        }
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[90vh] w-[calc(100%-2rem)] overflow-hidden p-0 sm:max-w-2xl"
        data-editor-source={request.source}
        data-testid="shared-view-config-editor"
        onEscapeKeyDown={(event) => {
          if (dirty) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (dirty) event.preventDefault();
        }}
        showCloseButton={false}
      >
        <div className="flex items-center justify-between gap-3 border-border/60 border-b px-4 py-3">
          <div className="min-w-0">
            <DialogTitle>{messages.base.viewControlsTitle}</DialogTitle>
            <div className="truncate text-muted-foreground text-xs">{view.name}</div>
          </div>
          <button
            aria-label={dirty ? messages.base.discardViewChanges : messages.common.close}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            data-testid="view-editor-discard"
            onClick={discard}
            title={dirty ? messages.base.discardViewChanges : messages.common.close}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        {focusedField ? (
          <div
            className="flex items-center gap-2 border-border/50 border-b bg-primary/5 px-4 py-2 text-xs"
            data-focused-field-id={focusedField.id}
            data-testid="header-contextual-view-editor"
          >
            <FieldTypeIcon className="size-3.5 text-primary" field={focusedField} />
            <span className="text-muted-foreground">{messages.base.editingFieldContext}</span>
            <span className="font-medium">{resolveIString(focusedField.name)}</span>
          </div>
        ) : null}

        <div className="grid grid-cols-3 border-border/60 border-b p-1" role="group">
          {(
            [
              ["fields", messages.base.viewFields, `${visibleCount}/${fields.length}`],
              ["filters", messages.base.viewFilters, String(draft.filters.length)],
              ["sorts", messages.base.viewSorts, String(draft.sorts.length)],
            ] as const
          ).map(([value, label, count]) => (
            <button
              aria-pressed={section === value}
              className={`flex h-9 items-center justify-center gap-1.5 rounded text-xs transition-colors ${
                section === value
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              }`}
              key={value}
              onClick={() => setSection(value)}
              type="button"
            >
              {label}
              <span className="text-[10px]">{count}</span>
            </button>
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {section === "fields" ? (
            <ViewFieldsEditor
              config={draft}
              fields={fields}
              onChange={setDraft}
              testId="toolbar-shared-fields"
            />
          ) : section === "filters" ? (
            <ViewFiltersEditor
              config={draft}
              fields={fields}
              focusedFieldId={request.focusedFieldId}
              onChange={setDraft}
            />
          ) : (
            <ViewSortsEditor
              config={draft}
              fields={fields}
              focusedFieldId={request.focusedFieldId}
              onChange={setDraft}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-border/60 border-t px-4 py-3">
          <div className="min-w-0 text-xs">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : invalid ? (
              <span className="text-destructive">{messages.base.filterValueRequired}</span>
            ) : dirty ? (
              <span className="text-muted-foreground">{messages.base.unsavedViewChanges}</span>
            ) : (
              <span className="text-muted-foreground">{messages.base.noViewChanges}</span>
            )}
          </div>
          <SplitSubmitButton
            changeRequestAction={{
              label: messages.base.updateViewRequest,
              loadingLabel: messages.common.submitting,
              onSubmit: () => submit(),
              isLoading: savingMode === "request",
            }}
            disabled={!dirty || invalid || savingMode !== null}
            hint={messages.common.mergeImmediatelyHint}
            immediateAction={{
              label: messages.base.updateViewNow,
              loadingLabel: messages.recordView.merging,
              onSubmit: () => submit({ mergeImmediately: true }),
              isLoading: savingMode === "merge",
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface SectionEditorProps {
  config: ViewConfigVO;
  fields: BaseFieldVO[];
  focusedFieldId?: string;
  onChange: (config: ViewConfigVO) => void;
}

const findField = (fields: BaseFieldVO[], condition: { fieldId?: string; fieldSlug: string }) =>
  fields.find((field) =>
    condition.fieldId ? field.id === condition.fieldId : field.slug === condition.fieldSlug,
  );

function ViewFiltersEditor({ config, fields, focusedFieldId, onChange }: SectionEditorProps) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const visibleSet = new Set(getVisibleViewFieldSlugs(config, fields));

  return (
    <div data-testid="shared-view-filters">
      <div className="flex items-center justify-between border-border/50 border-b px-3 py-2">
        <span className="text-muted-foreground text-xs">
          {fmt(messages.base.viewFilterCount, { count: config.filters.length })}
        </span>
        <div className="flex gap-1">
          <button
            className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors hover:bg-accent disabled:opacity-50"
            disabled={fields.length === 0}
            onClick={() => {
              const field = fields[0];
              if (field)
                onChange(addViewFilter(config, field, getFieldFilterOperators(field.type)[0]));
            }}
            type="button"
          >
            <Plus className="size-3" />
            {messages.base.addFilter}
          </button>
          <button
            className="h-7 rounded px-2 text-muted-foreground text-xs transition-colors hover:bg-accent disabled:opacity-50"
            disabled={config.filters.length === 0}
            onClick={() => onChange(clearAllViewFilters(config))}
            type="button"
          >
            {messages.base.clearAllFilters}
          </button>
        </div>
      </div>
      {config.filters.length === 0 ? (
        <div className="px-4 py-8 text-center text-muted-foreground text-xs">
          {messages.base.noViewFilters}
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {config.filters.map((filter, index) => {
            const field = findField(fields, filter) ?? fields[0];
            if (!field) return null;
            const operators = getFieldFilterOperators(field.type);
            const operator = operators.includes(filter.operator) ? filter.operator : operators[0];
            const focused = field.id === focusedFieldId;
            return (
              <div
                className={`grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] ${
                  focused ? "bg-primary/5" : ""
                }`}
                data-condition-field-slug={field.slug}
                data-focused-condition={focused ? "true" : undefined}
                key={`${filter.fieldId ?? filter.fieldSlug}-${index}`}
              >
                <label className="min-w-0">
                  <span className="sr-only">
                    {fmt(messages.base.filterFieldAt, { index: index + 1 })}
                  </span>
                  <select
                    aria-label={fmt(messages.base.filterFieldAt, { index: index + 1 })}
                    className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-xs"
                    onChange={(event) => {
                      const nextField = fields.find((item) => item.id === event.target.value);
                      if (nextField) {
                        onChange(
                          updateViewFilterAt(config, index, {
                            fieldId: nextField.id,
                            fieldSlug: nextField.slug,
                            operator: getFieldFilterOperators(nextField.type)[0],
                          }),
                        );
                      }
                    }}
                    value={field.id}
                  >
                    {fields.map((item) => (
                      <option key={item.id} value={item.id}>
                        {resolveIString(item.name)}
                      </option>
                    ))}
                  </select>
                  {!visibleSet.has(field.slug) ? (
                    <span className="mt-1 flex items-center gap-1 text-muted-foreground text-[10px]">
                      <EyeOff className="size-3" />
                      {messages.base.hiddenField}
                    </span>
                  ) : null}
                </label>
                <select
                  aria-label={fmt(messages.base.filterOperatorAt, { index: index + 1 })}
                  className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-xs"
                  onChange={(event) => {
                    const nextOperator = event.target.value as ViewFilterOperator;
                    onChange(
                      updateViewFilterAt(config, index, {
                        fieldId: field.id,
                        fieldSlug: field.slug,
                        operator: nextOperator,
                        ...(viewFilterOperatorNeedsValue(nextOperator) && filter.value !== undefined
                          ? { value: filter.value }
                          : {}),
                      }),
                    );
                  }}
                  value={operator}
                >
                  {operators.map((item) => (
                    <option key={item} value={item}>
                      {messages.base.filterOperators[item]}
                    </option>
                  ))}
                </select>
                <button
                  aria-label={fmt(messages.base.removeFilterAt, { index: index + 1 })}
                  className="inline-flex size-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                  onClick={() => onChange(clearViewFilterAt(config, index))}
                  title={messages.base.removeFilter}
                  type="button"
                >
                  <Trash2 className="size-3.5" />
                </button>
                {viewFilterOperatorNeedsValue(operator) ? (
                  <div className="sm:col-span-3">
                    <FilterValueControl
                      field={field}
                      index={index}
                      onChange={(value) =>
                        onChange(
                          updateViewFilterAt(config, index, {
                            fieldId: field.id,
                            fieldSlug: field.slug,
                            operator,
                            value,
                          }),
                        )
                      }
                      value={filter.value}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterValueControl({
  field,
  index,
  onChange,
  value,
}: {
  field: BaseFieldVO;
  index: number;
  onChange: (value: string) => void;
  value: unknown;
}) {
  const messages = useCoreI18n();
  const label = fmt(messages.base.filterValueAt, { index: index + 1 });
  if (field.type === "select" || field.type === "multiselect") {
    return (
      <select
        aria-label={label}
        className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-xs"
        onChange={(event) => onChange(event.target.value)}
        value={value === undefined || value === null ? "" : String(value)}
      >
        <option value="">{messages.base.chooseFilterValue}</option>
        {(field.options.choices ?? []).map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={label}
      className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-xs"
      onChange={(event) => onChange(event.target.value)}
      placeholder={messages.base.filterValue}
      type={
        field.type === "number"
          ? "number"
          : ["date", "created_time", "updated_time"].includes(field.type)
            ? "date"
            : "text"
      }
      value={value === undefined || value === null ? "" : String(value)}
    />
  );
}

function ViewSortsEditor({ config, fields, focusedFieldId, onChange }: SectionEditorProps) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const visibleSet = new Set(getVisibleViewFieldSlugs(config, fields));
  return (
    <div data-testid="shared-view-sorts">
      <div className="flex items-center justify-between border-border/50 border-b px-3 py-2">
        <span className="text-muted-foreground text-xs">
          {fmt(messages.base.viewSortCount, { count: config.sorts.length })}
        </span>
        <div className="flex gap-1">
          <button
            className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors hover:bg-accent disabled:opacity-50"
            disabled={fields.length === 0}
            onClick={() => {
              const unused = fields.find(
                (field) => !config.sorts.some((sort) => matchesViewField(sort, field)),
              );
              const field = unused ?? fields[0];
              if (field) onChange(addViewSort(config, field));
            }}
            type="button"
          >
            <Plus className="size-3" />
            {messages.base.addSort}
          </button>
          <button
            className="h-7 rounded px-2 text-muted-foreground text-xs transition-colors hover:bg-accent disabled:opacity-50"
            disabled={config.sorts.length === 0}
            onClick={() => onChange(clearAllViewSorts(config))}
            type="button"
          >
            {messages.base.clearAllSorts}
          </button>
        </div>
      </div>
      {config.sorts.length === 0 ? (
        <div className="px-4 py-8 text-center text-muted-foreground text-xs">
          {messages.base.noViewSorts}
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {config.sorts.map((sort, index) => {
            const field = findField(fields, sort) ?? fields[0];
            if (!field) return null;
            const focused = field.id === focusedFieldId;
            return (
              <div
                className={`grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5 ${
                  focused ? "bg-primary/5" : ""
                }`}
                data-condition-field-slug={field.slug}
                data-focused-condition={focused ? "true" : undefined}
                key={`${sort.fieldId ?? sort.fieldSlug}-${index}`}
              >
                <span className="flex size-5 items-center justify-center rounded bg-muted/60 text-[10px] text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <select
                    aria-label={fmt(messages.base.sortFieldAt, { index: index + 1 })}
                    className="h-8 w-full min-w-0 rounded-md border border-border/70 bg-background px-2 text-xs"
                    onChange={(event) => {
                      const nextField = fields.find((item) => item.id === event.target.value);
                      if (nextField) {
                        onChange(
                          updateViewSortAt(config, index, {
                            direction: sort.direction,
                            fieldId: nextField.id,
                            fieldSlug: nextField.slug,
                          }),
                        );
                      }
                    }}
                    value={field.id}
                  >
                    {fields.map((item) => (
                      <option key={item.id} value={item.id}>
                        {resolveIString(item.name)}
                      </option>
                    ))}
                  </select>
                  {!visibleSet.has(field.slug) ? (
                    <span className="mt-1 flex items-center gap-1 text-muted-foreground text-[10px]">
                      <EyeOff className="size-3" />
                      {messages.base.hiddenField}
                    </span>
                  ) : null}
                </div>
                <select
                  aria-label={fmt(messages.base.sortDirectionAt, { index: index + 1 })}
                  className="h-8 min-w-0 rounded-md border border-border/70 bg-background px-2 text-xs"
                  onChange={(event) =>
                    onChange(
                      updateViewSortAt(config, index, {
                        ...sort,
                        direction: event.target.value as "asc" | "desc",
                      }),
                    )
                  }
                  value={sort.direction}
                >
                  <option value="asc">{messages.base.sortAscending}</option>
                  <option value="desc">{messages.base.sortDescending}</option>
                </select>
                <div className="flex">
                  <button
                    aria-label={fmt(messages.base.moveSortUpAt, { index: index + 1 })}
                    className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-30"
                    disabled={index === 0}
                    onClick={() => onChange(moveViewSort(config, index, "up"))}
                    type="button"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    aria-label={fmt(messages.base.moveSortDownAt, { index: index + 1 })}
                    className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-30"
                    disabled={index === config.sorts.length - 1}
                    onClick={() => onChange(moveViewSort(config, index, "down"))}
                    type="button"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    aria-label={fmt(messages.base.removeSortAt, { index: index + 1 })}
                    className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
                    onClick={() => onChange(clearViewSortAt(config, index))}
                    title={messages.base.removeSort}
                    type="button"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
