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
  ViewConfigVO,
} from "busabase-contract/types";
import { ArrowRight, Minus, Plus } from "lucide-react";
import { iStringParse } from "openlib/i18n/i-string";
import { type CoreI18nMessages, fmt, useCoreI18n } from "../../../i18n";
import { getFieldName } from "../helpers/field";
import { fieldValueToString } from "../helpers/format";
import { getFieldOrderDiffModel, isFieldReorderOperation } from "../helpers/operation-diff";
import { FieldValuePreview } from "./field-preview";

export { getFieldOrderDiffModel, isFieldReorderOperation } from "../helpers/operation-diff";

export const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

export const valuesEqual = (left: unknown, right: unknown) =>
  stableStringify(left) === stableStringify(right);

export type FieldChangeStatus = "added" | "changed";

export interface OperationFieldChange {
  slug: string;
  label: string;
  beforeValue: unknown;
  afterValue: unknown;
  status: FieldChangeStatus;
}

export const isViewOperation = (operation: OperationVO) => operation.operation.startsWith("view_");

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
  }
  return getFieldName(changeRequest, slug);
};

export const getOperationFieldChanges = (
  changeRequest: ChangeRequestVO,
  operation: OperationVO,
  messages?: CoreI18nMessages,
): OperationFieldChange[] => {
  const before = operation.baseFields;
  return Object.entries(operation.headCommit.fields)
    .filter(([, value]) => value !== undefined)
    .map(([slug, afterValue]): OperationFieldChange => {
      const hasBefore = before != null && slug in before && before[slug] !== undefined;
      return {
        slug,
        label: getOperationFieldLabel(changeRequest, operation, slug, messages),
        beforeValue: hasBefore ? before[slug] : undefined,
        afterValue,
        status: hasBefore ? "changed" : "added",
      };
    })
    .filter(
      (change) => change.status === "added" || !valuesEqual(change.beforeValue, change.afterValue),
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
  kind: "sort" | "filter" | "field";
  label: string;
}

export const describeViewConfig = (
  changeRequest: ChangeRequestVO,
  config: unknown,
  messages: CoreI18nMessages,
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
  for (const filter of value.filters ?? []) {
    const operator = getFilterOperatorLabel(messages, filter.operator);
    const detail =
      filter.value === undefined || filter.value === null || filter.value === ""
        ? ""
        : ` ${fieldValueToString(filter.value)}`;
    rules.push({
      key: `filter:${filter.fieldSlug}:${filter.operator}:${stableStringify(filter.value)}`,
      kind: "filter",
      label: `${getFieldName(changeRequest, filter.fieldSlug)} ${operator}${detail}`,
    });
  }
  const visible = value.visibleFieldSlugs;
  if (visible === undefined || visible === null) {
    rules.push({ key: "field:*", kind: "field", label: messages.operationDiff.allFields });
  } else {
    for (const slug of visible) {
      rules.push({ key: `field:${slug}`, kind: "field", label: getFieldName(changeRequest, slug) });
    }
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
        : messages.operationDiff.field;
  const marker =
    status === "added" ? (
      <Plus className="text-emerald-600" size={13} />
    ) : status === "removed" ? (
      <Minus className="text-red-600" size={13} />
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
  const rules = describeViewConfig(changeRequest, config, messages);
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
  const beforeRules = describeViewConfig(changeRequest, before, messages);
  const afterRules = describeViewConfig(changeRequest, after, messages);
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
      <span className="inline-flex w-fit rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-[11px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
        {messages.operationDiff.added}
      </span>
    );
  }
  return (
    <span className="inline-flex w-fit rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-[11px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
      {messages.operationDiff.changed}
    </span>
  );
}

export function FieldValueDiff({
  change,
  field,
  messages,
}: {
  change: OperationFieldChange;
  field?: BaseFieldVO;
  messages: CoreI18nMessages;
}) {
  if (change.status === "added") {
    return (
      <div className="text-sm">
        <FieldValuePreview field={field} value={change.afterValue} />
      </div>
    );
  }
  if (isLongTextValue(change.afterValue) || isLongTextValue(change.beforeValue)) {
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-md border border-red-200/70 bg-red-50/40 px-3 py-2 text-muted-foreground text-sm line-through dark:border-red-900/50 dark:bg-red-950/20">
          <div className="mb-1 font-medium text-[11px] text-red-700 no-underline dark:text-red-300">
            {messages.operationDiff.before}
          </div>
          <FieldValuePreview field={field} value={change.beforeValue} />
        </div>
        <div className="rounded-md border border-emerald-200/70 bg-emerald-50/40 px-3 py-2 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/20">
          <div className="mb-1 font-medium text-[11px] text-emerald-700 dark:text-emerald-300">
            {messages.operationDiff.after}
          </div>
          <FieldValuePreview field={field} value={change.afterValue} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded-md bg-red-50 px-2 py-0.5 text-red-700 line-through dark:bg-red-950/40 dark:text-red-300">
        <FieldValuePreview field={field} value={change.beforeValue} />
      </span>
      <ArrowRight className="shrink-0 text-muted-foreground" size={14} />
      <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
        <FieldValuePreview field={field} value={change.afterValue} />
      </span>
    </div>
  );
}

export function OperationFieldChangeRow({
  change,
  changeRequest,
  operation,
}: {
  change: OperationFieldChange;
  changeRequest: ChangeRequestVO;
  operation: OperationVO;
}) {
  const messages = useCoreI18n();
  const isConfig = isViewOperation(operation) && change.slug === "config";
  const baseField = changeRequest.base?.fields.find((field) => field.slug === change.slug);

  return (
    <div className="grid gap-3 px-4 py-3 md:grid-cols-[150px_minmax(0,1fr)]">
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
          <FieldValueDiff change={change} field={baseField} messages={messages} />
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
        moved
          ? "border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20"
          : "border-transparent bg-muted/25"
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
  const { afterIds, beforeIds, fieldsById, movedIds } = getFieldOrderDiffModel(
    changeRequest,
    operation,
  );

  if (beforeIds.length === 0 || afterIds.length === 0) {
    return (
      <div className="mt-3 rounded-lg border bg-background/40 px-4 py-5 text-muted-foreground text-sm">
        {messages.operationDiff.fieldOrderUnavailable}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border bg-background/40 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-medium text-sm">{messages.operationDiff.fieldOrder}</div>
        <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-[11px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
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
  operation,
}: {
  changeRequest: ChangeRequestVO;
  operation: OperationVO;
}) {
  const messages = useCoreI18n();
  if (isFieldReorderOperation(operation)) {
    return <FieldOrderDiff changeRequest={changeRequest} operation={operation} />;
  }

  const changes = getOperationFieldChanges(changeRequest, operation, messages);
  if (changes.length === 0) {
    return (
      <div className="mt-3 rounded-lg border bg-background/40 px-4 py-5 text-muted-foreground text-sm">
        {messages.review.noFieldChanges}
      </div>
    );
  }
  return (
    <div className="mt-3 divide-y overflow-hidden rounded-lg border bg-background/40">
      {changes.map((change) => (
        <OperationFieldChangeRow
          change={change}
          changeRequest={changeRequest}
          key={change.slug}
          operation={operation}
        />
      ))}
    </div>
  );
}
