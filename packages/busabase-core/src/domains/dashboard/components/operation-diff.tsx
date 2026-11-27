import {
  getAutoShowNewFields,
  getGridRowHeight,
  isGridRowHeight,
  isViewFilterGroup,
  isViewSummaryFunction,
  type ViewFilterConditionVO,
} from "busabase-contract/types";
// ============================================================================
// Operation field-change rendering — before → after hybrid for records + views.
// `operation.baseFields` carries the canonical prior values (null for creations),
// so we only surface fields that actually changed and render each one by type:
// view config → readable rule diff, long text → stacked blocks, scalars → inline.
// ============================================================================

import type {
  BaseFieldVO,
  ChangeRequestVO,
  OperationVO,
  RecordVO,
  UserRefVO,
  ViewConfigVO,
} from "busabase-contract/types";
import { ArrowRight, Minus, Plus } from "lucide-react";
import { iStringParse } from "openlib/i18n/i-string";
import { type CoreI18nMessages, fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { fieldVisibilityMessages } from "../../../i18n/field-visibility";
import { gridGroupSummaryMessages, summaryMenuLabel } from "../../../i18n/grid-group-summary";
import { gridRowHeightMessages } from "../../../i18n/grid-row-height";
import { getFieldName } from "../helpers/field";
import { fieldValueToString } from "../helpers/format";
import {
  extractOperationFieldChanges,
  type FieldChangeStatus,
  getFieldOrderDiffModel,
  isFieldReorderOperation,
  isViewOperation,
  type OperationFieldValueChange,
  stableStringify,
} from "../helpers/operation-diff";
import { DriveFieldPathList } from "./drive-field-tree";
import { FieldValuePreview } from "./field-preview";

export {
  type FieldChangeStatus,
  getFieldOrderDiffModel,
  isFieldReorderOperation,
  isInternalFormulaMetadata,
  isViewOperation,
  stableStringify,
  valuesEqual,
} from "../helpers/operation-diff";

export interface OperationFieldChange extends OperationFieldValueChange {
  label: string;
}

export const getOperationFieldLabel = (
  changeRequest: ChangeRequestVO,
  operation: OperationVO,
  slug: string,
  messages?: CoreI18nMessages,
) => {
  if (isViewOperation(operation)) {
    if (slug === "name") return messages?.operationDiff.name ?? "Name";
    if (slug === "config") return messages?.operationDiff.configuration ?? "Configuration";
    if (slug === "description") return messages?.operationDiff.description ?? "Description";
    if (slug === "position") return messages?.operationDiff.position ?? "Position";
  }
  return getFieldName(changeRequest, slug);
};

export const getOperationFieldChanges = (
  changeRequest: ChangeRequestVO,
  operation: OperationVO,
  messages?: CoreI18nMessages,
): OperationFieldChange[] => {
  // A view's tab position is stored 0-based; people count tabs from 1.
  const display = (slug: string, value: unknown) =>
    isViewOperation(operation) && slug === "position" && typeof value === "number"
      ? value + 1
      : value;
  return extractOperationFieldChanges(operation).map(
    (change): OperationFieldChange => ({
      ...change,
      label: getOperationFieldLabel(changeRequest, operation, change.slug, messages),
      beforeValue:
        change.beforeValue === undefined ? undefined : display(change.slug, change.beforeValue),
      afterValue: display(change.slug, change.afterValue),
    }),
  );
};

export const isLongTextValue = (value: unknown) =>
  typeof value === "string" && (value.length > 56 || value.includes("\n"));

export const getFilterOperatorLabel = (messages: CoreI18nMessages, operator: string) => {
  const labels: Record<string, string> = {
    contains: messages.operationDiff.contains,
    equals: messages.operationDiff.equals,
    not_empty: messages.operationDiff.notEmpty,
    is_empty: messages.operationDiff.isEmpty,
    is_true: messages.operationDiff.isTrue,
    is_false: messages.operationDiff.isFalse,
  };
  return labels[operator] ?? operator;
};

export interface ViewConfigRule {
  key: string;
  kind:
    | "sort"
    | "filter"
    | "field"
    | "order"
    | "width"
    | "policy"
    | "density"
    | "group"
    | "summary";
  label: string;
}

export const describeViewConfig = (
  changeRequest: ChangeRequestVO,
  config: unknown,
  messages: CoreI18nMessages,
  automaticLabel = fieldVisibilityMessages.en.automatic,
  rowHeightLabels = gridRowHeightMessages.en,
  showDefaultRowHeight = false,
  groupSummaryLabels = gridGroupSummaryMessages.en,
): ViewConfigRule[] => {
  const value = (config ?? {}) as ViewConfigVO;
  const rules: ViewConfigRule[] = [];
  for (const sort of value.sorts ?? []) {
    rules.push({
      key: `sort:${sort.fieldSlug}:${sort.direction}`,
      kind: "sort",
      label: `${getFieldName(changeRequest, sort.fieldSlug)} ${sort.direction === "desc" ? "Z → A" : "A → Z"}`,
    });
  }
  const describeCondition = (filter: ViewFilterConditionVO): string => {
    if (isViewFilterGroup(filter))
      return `(${filter.conditions.map(describeCondition).join(filter.conjunction === "or" ? " OR " : " AND ")})`;
    const operator = getFilterOperatorLabel(messages, filter.operator);
    const detail =
      filter.value === undefined || filter.value === null || filter.value === ""
        ? ""
        : ` ${fieldValueToString(filter.value)}`;
    return `${getFieldName(changeRequest, filter.fieldSlug)} ${operator}${detail}`;
  };
  const grouped = value.filterConjunction === "or" || value.filters?.some(isViewFilterGroup);
  if (grouped) {
    rules.push({
      key: `filter-expression:${stableStringify({ filters: value.filters, conjunction: value.filterConjunction ?? "and" })}`,
      kind: "filter",
      label: (value.filters ?? [])
        .map(describeCondition)
        .join(value.filterConjunction === "or" ? " OR " : " AND "),
    });
  } else
    for (const filter of value.filters ?? []) {
      if (isViewFilterGroup(filter)) continue;
      rules.push({
        key: `filter:${filter.fieldSlug}:${filter.operator}:${stableStringify(filter.value)}`,
        kind: "filter",
        label: describeCondition(filter),
      });
    }
  const visible = value.visibleFieldSlugs;
  const automatic = getAutoShowNewFields(value);
  rules.push({
    key: `field-policy:${automatic}`,
    kind: "policy",
    label: `${automaticLabel}: ${automatic ? messages.common.yes : messages.common.no}`,
  });
  if (automatic || visible === undefined || visible === null) {
    rules.push({ key: "field:*", kind: "field", label: messages.operationDiff.allFields });
    for (const slug of [...new Set(value.hiddenFieldSlugs ?? [])]) {
      rules.push({
        key: `hidden-field:${slug}`,
        kind: "field",
        label: `${messages.base.hiddenField} · ${getFieldName(changeRequest, slug)}`,
      });
    }
  } else {
    for (const slug of visible) {
      rules.push({ key: `field:${slug}`, kind: "field", label: getFieldName(changeRequest, slug) });
    }
  }
  const order = value.fieldOrderSlugs ?? visible;
  if (Array.isArray(order)) {
    rules.push({
      key: `order:${order.join("\u0000")}`,
      kind: "order",
      label: order.map((slug) => getFieldName(changeRequest, slug)).join(" → "),
    });
  }
  for (const [slug, width] of Object.entries(value.fieldWidths ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    rules.push({
      key: `width:${slug}:${width}`,
      kind: "width",
      label: `${getFieldName(changeRequest, slug)} · ${width}px`,
    });
  }
  if (value.rowHeight !== undefined || showDefaultRowHeight) {
    const preset = isGridRowHeight(value.rowHeight) ? value.rowHeight : "medium";
    rules.push({
      key: `row-height:${preset}`,
      kind: "density",
      label: `${rowHeightLabels.title} · ${rowHeightLabels[preset]} (${getGridRowHeight(preset)}px)`,
    });
  }
  for (const level of Array.isArray(value.groupBy) ? value.groupBy : []) {
    if (!level || typeof level.fieldSlug !== "string") continue;
    const direction = level.direction === "desc" ? "desc" : "asc";
    const isCheckbox =
      changeRequest.base?.fields.find((field) =>
        level.fieldId ? field.id === level.fieldId : field.slug === level.fieldSlug,
      )?.type === "checkbox";
    const order = isCheckbox
      ? direction === "desc"
        ? groupSummaryLabels.orderCheckboxDesc
        : groupSummaryLabels.orderCheckboxAsc
      : direction === "desc"
        ? groupSummaryLabels.orderSelectDesc
        : groupSummaryLabels.orderSelectAsc;
    rules.push({
      key: `group:${level.fieldSlug}:${direction}`,
      kind: "group",
      label: `${groupSummaryLabels.groupBy} · ${getFieldName(changeRequest, level.fieldSlug)} · ${order}`,
    });
  }
  for (const [slug, fn] of Object.entries(value.fieldSummaries ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!isViewSummaryFunction(fn)) continue;
    rules.push({
      key: `summary:${slug}:${fn}`,
      kind: "summary",
      label: `${groupSummaryLabels.summaryRule} · ${getFieldName(changeRequest, slug)} · ${summaryMenuLabel(groupSummaryLabels, fn)}`,
    });
  }
  return rules;
};

export function ViewConfigRuleLine({
  messages,
  rule,
  status,
}: {
  messages: CoreI18nMessages;
  rule: ViewConfigRule;
  status: "added" | "removed" | "unchanged";
}) {
  const kindLabel =
    rule.kind === "sort"
      ? messages.operationDiff.sort
      : rule.kind === "filter"
        ? messages.operationDiff.filter
        : rule.kind === "width"
          ? messages.operationDiff.width
          : rule.kind === "order"
            ? messages.operationDiff.order
            : rule.kind === "policy" ||
                rule.kind === "density" ||
                rule.kind === "group" ||
                rule.kind === "summary"
              ? messages.operationDiff.configuration
              : messages.operationDiff.field;
  const marker =
    status === "added" ? (
      <Plus className="text-merged-strong dark:text-merged-soft" size={13} />
    ) : status === "removed" ? (
      <Minus className="text-rejected-strong dark:text-rejected-soft" size={13} />
    ) : (
      <span className="inline-block w-[13px]" />
    );
  return (
    <div
      className={`flex items-start gap-2 text-sm ${
        status === "removed" ? "text-muted-foreground line-through" : ""
      }`}
    >
      <span className="mt-0.5 shrink-0">{marker}</span>
      <span className="mt-px shrink-0 rounded border bg-muted/40 px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {kindLabel}
      </span>
      <span className="min-w-0">{rule.label}</span>
    </div>
  );
}

export function ViewConfigRules({
  changeRequest,
  config,
  messages,
}: {
  changeRequest: ChangeRequestVO;
  config: unknown;
  messages: CoreI18nMessages;
}) {
  const locale = useCoreLocale();
  const rules = describeViewConfig(
    changeRequest,
    config,
    messages,
    fieldVisibilityMessages[locale].automatic,
    gridRowHeightMessages[locale],
    false,
    gridGroupSummaryMessages[locale],
  );
  return (
    <div className="flex flex-col gap-1.5">
      {rules.map((rule) => (
        <ViewConfigRuleLine key={rule.key} messages={messages} rule={rule} status="unchanged" />
      ))}
    </div>
  );
}

export function ViewConfigDiff({
  changeRequest,
  before,
  after,
  messages,
}: {
  changeRequest: ChangeRequestVO;
  before: unknown;
  after: unknown;
  messages: CoreI18nMessages;
}) {
  const locale = useCoreLocale();
  const automaticLabel = fieldVisibilityMessages[locale].automatic;
  const showRowHeight =
    (before as ViewConfigVO | null)?.rowHeight !== undefined ||
    (after as ViewConfigVO | null)?.rowHeight !== undefined;
  const describeConfig = (config: unknown) =>
    describeViewConfig(
      changeRequest,
      config,
      messages,
      automaticLabel,
      gridRowHeightMessages[locale],
      showRowHeight,
      gridGroupSummaryMessages[locale],
    );
  const beforeRules = describeConfig(before);
  const afterRules = describeConfig(after);
  const beforeKeys = new Set(beforeRules.map((rule) => rule.key));
  const afterKeys = new Set(afterRules.map((rule) => rule.key));
  const lines: { rule: ViewConfigRule; status: "added" | "removed" | "unchanged" }[] = [
    ...afterRules.map((rule) => ({
      rule,
      status: beforeKeys.has(rule.key) ? ("unchanged" as const) : ("added" as const),
    })),
    ...beforeRules
      .filter((rule) => !afterKeys.has(rule.key))
      .map((rule) => ({ rule, status: "removed" as const })),
  ];
  return (
    <div className="flex flex-col gap-1.5">
      {lines.map(({ rule, status }) => (
        <ViewConfigRuleLine
          key={`${status}:${rule.key}`}
          messages={messages}
          rule={rule}
          status={status}
        />
      ))}
    </div>
  );
}

export function ChangeStatusBadge({
  messages,
  status,
}: {
  messages: CoreI18nMessages;
  status: FieldChangeStatus;
}) {
  if (status === "added") {
    return (
      <span className="inline-flex w-fit rounded-md bg-merged/17 px-2 py-0.5 font-medium text-[11px] text-merged-strong dark:text-merged-soft">
        {messages.operationDiff.added}
      </span>
    );
  }
  return (
    <span className="inline-flex w-fit rounded-md bg-review/17 px-2 py-0.5 font-medium text-[11px] text-review-strong dark:text-review-soft">
      {messages.operationDiff.changed}
    </span>
  );
}

export function FieldValueDiff({
  change,
  field,
  fieldUsers,
  records,
  messages,
}: {
  change: OperationFieldChange;
  field?: BaseFieldVO;
  /**
   * People the diff may need to name — a `member` value proposed by a Change
   * Request has no record behind it yet, so `RecordVO.fieldUsers` cannot cover
   * it and the reviewer's own roster answers instead. Absent → the diff shows
   * an id-based label rather than a name.
   */
  fieldUsers?: Record<string, UserRefVO>;
  records?: RecordVO[];
  messages: CoreI18nMessages;
}) {
  // A drive value is reviewed as the PATHS of its files: a file that only
  // moved or was renamed would otherwise show the same chip on both sides.
  const drive = field?.type === "drive";
  const preview = (value: unknown) =>
    drive ? (
      <DriveFieldPathList value={value} />
    ) : (
      <FieldValuePreview field={field} fieldUsers={fieldUsers} records={records} value={value} />
    );
  if (change.status === "added") {
    return <div className="text-sm">{preview(change.afterValue)}</div>;
  }
  if (drive || isLongTextValue(change.afterValue) || isLongTextValue(change.beforeValue)) {
    return (
      <div className="flex flex-col gap-2">
        <div
          className={`rounded-md border border-rejected/35 bg-rejected/17 px-3 py-2 text-muted-foreground text-sm ${drive ? "" : "line-through"}`}
        >
          <div className="mb-1 font-medium text-[11px] text-rejected-strong no-underline dark:text-rejected-soft">
            {messages.operationDiff.before}
          </div>
          {preview(change.beforeValue)}
        </div>
        <div className="rounded-md border border-merged/35 bg-merged/17 px-3 py-2 text-sm">
          <div className="mb-1 font-medium text-[11px] text-merged-strong dark:text-merged-soft">
            {messages.operationDiff.after}
          </div>
          {preview(change.afterValue)}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded-md bg-rejected/17 px-2 py-0.5 text-rejected-strong line-through dark:text-rejected-soft">
        {preview(change.beforeValue)}
      </span>
      <ArrowRight className="shrink-0 text-muted-foreground" size={14} />
      <span className="rounded-md bg-merged/17 px-2 py-0.5 text-merged-strong dark:text-merged-soft">
        {preview(change.afterValue)}
      </span>
    </div>
  );
}

export function OperationFieldChangeRow({
  change,
  changeRequest,
  fieldUsers,
  records,
  operation,
}: {
  change: OperationFieldChange;
  changeRequest: ChangeRequestVO;
  /**
   * People the diff may need to name — a `member` value proposed by a Change
   * Request has no record behind it yet, so `RecordVO.fieldUsers` cannot cover
   * it and the reviewer's own roster answers instead. Absent → the diff shows
   * an id-based label rather than a name.
   */
  fieldUsers?: Record<string, UserRefVO>;
  records?: RecordVO[];
  operation: OperationVO;
}) {
  const messages = useCoreI18n();
  const isConfig = isViewOperation(operation) && change.slug === "config";
  // A view operation's keys (name, position, …) are view properties, not Base
  // fields — a Base that happens to have a field slugged "position" must not
  // render the view's position through that field's type.
  const baseField = isViewOperation(operation)
    ? undefined
    : changeRequest.base?.fields.find((field) => field.slug === change.slug);

  return (
    <div className="grid gap-3 px-1 py-3 md:grid-cols-[150px_minmax(0,1fr)]">
      <div className="flex flex-col gap-1.5">
        <span className="font-medium text-sm">{change.label}</span>
        <ChangeStatusBadge messages={messages} status={change.status} />
      </div>
      <div className="min-w-0">
        {isConfig ? (
          change.status === "changed" ? (
            <ViewConfigDiff
              changeRequest={changeRequest}
              before={change.beforeValue}
              after={change.afterValue}
              messages={messages}
            />
          ) : (
            <ViewConfigRules
              changeRequest={changeRequest}
              config={change.afterValue}
              messages={messages}
            />
          )
        ) : (
          <FieldValueDiff
            change={change}
            field={baseField}
            fieldUsers={fieldUsers}
            records={records}
            messages={messages}
          />
        )}
      </div>
    </div>
  );
}

const getFieldOrderName = (field: BaseFieldVO | undefined, messages: CoreI18nMessages) =>
  field ? iStringParse(field.name) : messages.operationDiff.unknownField;

function FieldOrderRow({
  field,
  id,
  index,
  messages,
  moved,
}: {
  field?: BaseFieldVO;
  id: string;
  index: number;
  messages: CoreI18nMessages;
  moved: boolean;
}) {
  return (
    <li
      className={`grid grid-cols-[2rem_minmax(0,1fr)] gap-2 rounded-md border px-2.5 py-2 text-sm ${
        moved ? "border-review/35 bg-review/17" : "border-transparent bg-muted/25"
      }`}
    >
      <span className="text-right font-mono text-muted-foreground tabular-nums">{index + 1}</span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{getFieldOrderName(field, messages)}</span>
        <span className="block truncate font-mono text-muted-foreground text-xs">
          {field ? field.slug : id}
        </span>
      </span>
    </li>
  );
}

function FieldOrderList({
  fieldsById,
  ids,
  messages,
  movedIds,
  title,
}: {
  fieldsById: Map<string, BaseFieldVO>;
  ids: string[];
  messages: CoreI18nMessages;
  movedIds: Set<string>;
  title: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {title}
      </div>
      <ol className="flex flex-col gap-1.5">
        {ids.map((id, index) => (
          <FieldOrderRow
            field={fieldsById.get(id)}
            id={id}
            index={index}
            key={`${title}:${id}`}
            messages={messages}
            moved={movedIds.has(id)}
          />
        ))}
      </ol>
    </div>
  );
}

export function FieldOrderDiff({
  changeRequest,
  operation,
}: {
  changeRequest: ChangeRequestVO;
  operation: OperationVO;
}) {
  const messages = useCoreI18n();
  const {
    afterIds,
    afterPrimaryId,
    beforeIds,
    beforePrimaryId,
    fieldsById,
    movedIds,
    primaryChanged,
  } = getFieldOrderDiffModel(changeRequest, operation);

  if (beforeIds.length === 0 || afterIds.length === 0) {
    return (
      <div className="mt-3 rounded-lg border bg-background/40 px-4 py-5 text-muted-foreground text-sm">
        {messages.operationDiff.fieldOrderUnavailable}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border bg-background/40 p-3">
      {primaryChanged && beforePrimaryId && afterPrimaryId ? (
        <div className="mb-3 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 font-medium text-sm">
          {fmt(messages.operationDiff.recordTitleChange, {
            before: iStringParse(fieldsById.get(beforePrimaryId)?.name ?? beforePrimaryId),
            after: iStringParse(fieldsById.get(afterPrimaryId)?.name ?? afterPrimaryId),
          })}
        </div>
      ) : null}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-medium text-sm">{messages.operationDiff.fieldOrder}</div>
        <span className="shrink-0 rounded-md border border-review/35 bg-review/17 px-2 py-0.5 font-medium text-[11px] text-review-strong dark:text-review-soft">
          {fmt(messages.operationDiff.movedCount, { count: movedIds.size })}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <FieldOrderList
          fieldsById={fieldsById}
          ids={beforeIds}
          messages={messages}
          movedIds={movedIds}
          title={messages.operationDiff.before}
        />
        <FieldOrderList
          fieldsById={fieldsById}
          ids={afterIds}
          messages={messages}
          movedIds={movedIds}
          title={messages.operationDiff.after}
        />
      </div>
    </div>
  );
}

export function OperationFieldChanges({
  changeRequest,
  fieldUsers,
  records,
  operation,
}: {
  changeRequest: ChangeRequestVO;
  /**
   * People the diff may need to name — a `member` value proposed by a Change
   * Request has no record behind it yet, so `RecordVO.fieldUsers` cannot cover
   * it and the reviewer's own roster answers instead. Absent → the diff shows
   * an id-based label rather than a name.
   */
  fieldUsers?: Record<string, UserRefVO>;
  records?: RecordVO[];
  operation: OperationVO;
}) {
  const messages = useCoreI18n();
  if (isFieldReorderOperation(operation)) {
    return <FieldOrderDiff changeRequest={changeRequest} operation={operation} />;
  }

  const changes = getOperationFieldChanges(changeRequest, operation, messages);
  if (changes.length === 0) {
    return (
      <div className="mt-3 bg-muted/20 px-3 py-4 text-muted-foreground text-sm">
        {messages.review.noFieldChanges}
      </div>
    );
  }
  return (
    <div className="mt-3 divide-y divide-border/50">
      {changes.map((change) => (
        <OperationFieldChangeRow
          change={change}
          changeRequest={changeRequest}
          fieldUsers={fieldUsers}
          records={records}
          key={change.slug}
          operation={operation}
        />
      ))}
    </div>
  );
}
