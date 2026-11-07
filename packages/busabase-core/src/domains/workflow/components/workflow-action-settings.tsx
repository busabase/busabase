"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  WORKFLOW_CREATE_RECORD_ACTION,
  WORKFLOW_DELETE_RECORD_ACTION,
  WORKFLOW_FIND_RECORDS_ACTION,
  WORKFLOW_FIND_RECORDS_DEFAULT_LIMIT,
  WORKFLOW_FIND_RECORDS_MAX,
  WORKFLOW_READ_RECORD_ACTION,
  WORKFLOW_UPDATE_RECORD_ACTION,
} from "busabase-contract/domains/workflow/run";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { Textarea } from "kui/textarea";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { type CoreI18nMessages, fmt, useCoreI18n } from "../../../i18n";
import { workflowStepReference } from "../utils/run-view";
import { WorkflowTriggerBasePicker } from "./workflow-trigger-base-picker";

/** What the canvas shows for an action step. Names it does not know stay as typed. */
export const workflowActionLabel = (actionName: string, messages: CoreI18nMessages): string => {
  const copy = messages.richNodes;
  switch (actionName.trim()) {
    case WORKFLOW_READ_RECORD_ACTION:
      return copy.actionReadRecord;
    case WORKFLOW_UPDATE_RECORD_ACTION:
      return copy.actionUpdateRecord;
    case WORKFLOW_CREATE_RECORD_ACTION:
      return copy.actionCreateRecord;
    case WORKFLOW_DELETE_RECORD_ACTION:
      return copy.actionDeleteRecord;
    case WORKFLOW_FIND_RECORDS_ACTION:
      return copy.actionFindRecords;
    default:
      return actionName;
  }
};

const KNOWN_ACTIONS: readonly string[] = [
  WORKFLOW_READ_RECORD_ACTION,
  WORKFLOW_UPDATE_RECORD_ACTION,
  WORKFLOW_CREATE_RECORD_ACTION,
  WORKFLOW_DELETE_RECORD_ACTION,
  WORKFLOW_FIND_RECORDS_ACTION,
];

/** `fields` as JSON text. Only a valid object reaches the graph, so a half-typed edit never saves. */
function FieldsJsonEditor({
  fields,
  onChange,
}: {
  fields: Record<string, unknown>;
  onChange: (fields: Record<string, unknown>) => void;
}) {
  const messages = useCoreI18n();
  const [text, setText] = useState(() =>
    Object.keys(fields).length ? JSON.stringify(fields, null, 2) : "",
  );
  const [invalid, setInvalid] = useState(false);
  const update = (next: string) => {
    setText(next);
    if (!next.trim()) {
      setInvalid(false);
      onChange({});
      return;
    }
    try {
      const parsed: unknown = JSON.parse(next);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      setInvalid(false);
      onChange(parsed as Record<string, unknown>);
    } catch {
      setInvalid(true);
    }
  };
  return (
    <label className="grid gap-1.5 text-muted-foreground text-xs" htmlFor="rich-node-action-fields">
      {messages.richNodes.updateRecordFields}
      <Textarea
        aria-describedby="rich-node-action-fields-hint"
        aria-invalid={invalid}
        className="font-mono text-xs"
        data-workflow-action-fields=""
        id="rich-node-action-fields"
        onChange={(event) => update(event.target.value)}
        placeholder={'{"status": "qualified", "score": "=steps.score.score"}'}
        rows={5}
        spellCheck={false}
        value={text}
      />
      {invalid ? (
        <span
          className="text-[11px] text-destructive leading-snug"
          data-workflow-action-fields-error=""
          id="rich-node-action-fields-hint"
          role="alert"
        >
          {messages.richNodes.updateRecordFieldsInvalid}
        </span>
      ) : (
        <span
          className="text-[11px] text-muted-foreground/80 leading-snug"
          id="rich-node-action-fields-hint"
        >
          {messages.richNodes.updateRecordFieldsHint}
        </span>
      )}
    </label>
  );
}

/** Which records a Find records step reads, and whether each gets its own run. */
export interface WorkflowFindRecordsSettings {
  viewId: string;
  /** `null` until the author sets one: the step then returns up to the default. */
  limit: number | null;
  forEach: boolean;
}

interface WorkflowActionSettingsProps {
  orpc: BusabaseQueryUtils;
  stepId: string;
  actionName: string;
  fields: Record<string, unknown>;
  targetRecordId: string;
  baseId: string;
  find: WorkflowFindRecordsSettings;
  onChange: (
    patch: {
      actionName?: string;
      fields?: Record<string, unknown>;
      targetRecordId?: string;
      baseId?: string;
    } & Partial<WorkflowFindRecordsSettings>,
  ) => void;
}

/** The View a Find records step reads, among the chosen Base's Views. */
function FindRecordsViewPicker({
  orpc,
  baseId,
  value,
  onChange,
}: {
  orpc: BusabaseQueryUtils;
  baseId: string;
  value: string;
  onChange: (viewId: string) => void;
}) {
  const messages = useCoreI18n();
  const copy = messages.richNodes;
  const viewsQuery = useQuery({
    ...orpc.bases.listViews.queryOptions({ input: { baseId } }),
    enabled: Boolean(baseId),
  });
  const views = baseId ? (viewsQuery.data ?? []) : [];
  const missing = value !== "" && !viewsQuery.isPending && !views.some((view) => view.id === value);
  return (
    <label className="grid gap-1.5 text-muted-foreground text-xs" htmlFor="rich-node-find-view">
      {copy.findRecordsView}
      <select
        className="h-9 border border-input bg-card px-3 text-foreground text-sm"
        data-workflow-find-view=""
        disabled={!baseId}
        id="rich-node-find-view"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">{copy.findRecordsAllRecords}</option>
        {views.map((view) => (
          <option key={view.id} value={view.id}>
            {view.name}
          </option>
        ))}
        {missing ? (
          <option value={value}>{fmt(copy.findRecordsUnknownView, { id: value })}</option>
        ) : null}
      </select>
    </label>
  );
}

/** Base, View, how many, and once-per-record for a Find records step. */
function FindRecordsSettings({
  orpc,
  baseId,
  find,
  onChange,
}: {
  orpc: BusabaseQueryUtils;
  baseId: string;
  find: WorkflowFindRecordsSettings;
  onChange: WorkflowActionSettingsProps["onChange"];
}) {
  const copy = useCoreI18n().richNodes;
  return (
    <>
      <WorkflowTriggerBasePicker
        emptyLabel={copy.chooseBase}
        id="rich-node-action-base"
        // Views belong to one Base: a new Base starts from all its records.
        onChange={(next) => onChange({ baseId: next, viewId: "" })}
        orpc={orpc}
        value={baseId}
      />
      <FindRecordsViewPicker
        baseId={baseId}
        onChange={(viewId) => onChange({ viewId })}
        orpc={orpc}
        value={find.viewId}
      />
      <label className="grid gap-1.5 text-muted-foreground text-xs" htmlFor="rich-node-find-limit">
        {copy.findRecordsLimit}
        <Input
          data-workflow-find-limit=""
          id="rich-node-find-limit"
          max={WORKFLOW_FIND_RECORDS_MAX}
          min={1}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            onChange({
              limit: Number.isFinite(next)
                ? Math.min(Math.max(next, 1), WORKFLOW_FIND_RECORDS_MAX)
                : null,
            });
          }}
          placeholder={String(WORKFLOW_FIND_RECORDS_DEFAULT_LIMIT)}
          type="number"
          value={find.limit ?? ""}
        />
        <span className="text-[11px] leading-snug text-muted-foreground/80">
          {fmt(copy.findRecordsLimitHint, { max: WORKFLOW_FIND_RECORDS_MAX })}
        </span>
      </label>
      <label
        className="flex items-start gap-2 text-foreground text-xs"
        htmlFor="rich-node-find-each"
      >
        <input
          checked={find.forEach}
          className="mt-0.5"
          data-workflow-find-each=""
          id="rich-node-find-each"
          onChange={(event) => onChange({ forEach: event.target.checked })}
          type="checkbox"
        />
        <span className="grid gap-1">
          {copy.findRecordsForEach}
          <span className="text-[11px] leading-snug text-muted-foreground/80">
            {copy.findRecordsForEachHint}
          </span>
        </span>
      </label>
    </>
  );
}

/** What an action step does, and the settings that action needs. */
export function WorkflowActionSettings({
  orpc,
  stepId,
  actionName,
  fields,
  targetRecordId,
  baseId,
  find,
  onChange,
}: WorkflowActionSettingsProps) {
  const messages = useCoreI18n();
  const copy = messages.richNodes;
  const action = actionName.trim();
  const custom = action && !KNOWN_ACTIONS.includes(action) ? action : null;
  const hint =
    action === WORKFLOW_READ_RECORD_ACTION
      ? copy.readRecordHint
      : action === WORKFLOW_UPDATE_RECORD_ACTION
        ? copy.updateRecordHint
        : action === WORKFLOW_CREATE_RECORD_ACTION
          ? copy.createRecordHint
          : action === WORKFLOW_DELETE_RECORD_ACTION
            ? copy.deleteRecordHint
            : action === WORKFLOW_FIND_RECORDS_ACTION
              ? copy.findRecordsHint
              : custom
                ? copy.customActionHint
                : null;
  const targetsRecord =
    action === WORKFLOW_UPDATE_RECORD_ACTION || action === WORKFLOW_DELETE_RECORD_ACTION;
  const setsFields =
    action === WORKFLOW_UPDATE_RECORD_ACTION || action === WORKFLOW_CREATE_RECORD_ACTION;
  return (
    <>
      <label className="grid gap-1.5 text-muted-foreground text-xs" htmlFor="rich-node-action-name">
        {copy.action}
        <select
          className="h-9 border border-input bg-card px-3 text-foreground text-sm"
          data-workflow-action-name=""
          id="rich-node-action-name"
          onChange={(event) => onChange({ actionName: event.target.value })}
          value={action}
        >
          <option value="">{copy.actionChoose}</option>
          {KNOWN_ACTIONS.map((name) => (
            <option key={name} value={name}>
              {workflowActionLabel(name, messages)}
            </option>
          ))}
          {custom ? (
            <option value={custom}>{fmt(copy.customEventOption, { name: custom })}</option>
          ) : null}
        </select>
        {hint ? (
          <span className="text-[11px] leading-snug text-muted-foreground/80">{hint}</span>
        ) : null}
      </label>
      {action === WORKFLOW_CREATE_RECORD_ACTION ? (
        <WorkflowTriggerBasePicker
          emptyLabel={copy.chooseBase}
          id="rich-node-action-base"
          onChange={(next) => onChange({ baseId: next })}
          orpc={orpc}
          value={baseId}
        />
      ) : null}
      {action === WORKFLOW_FIND_RECORDS_ACTION ? (
        <FindRecordsSettings baseId={baseId} find={find} onChange={onChange} orpc={orpc} />
      ) : null}
      {targetsRecord ? (
        <label
          className="grid gap-1.5 text-muted-foreground text-xs"
          htmlFor="rich-node-action-target"
        >
          {copy.targetRecord}
          <Input
            data-workflow-action-target=""
            id="rich-node-action-target"
            onChange={(event) => onChange({ targetRecordId: event.target.value })}
            spellCheck={false}
            value={targetRecordId}
          />
          <span className="text-[11px] leading-snug text-muted-foreground/80">
            {copy.targetRecordHint}
          </span>
        </label>
      ) : null}
      {setsFields ? (
        <FieldsJsonEditor
          fields={fields}
          key={stepId}
          onChange={(next) => onChange({ fields: next })}
        />
      ) : null}
    </>
  );
}

/**
 * How to refer to this step in a formula or condition. Step ids are generated,
 * so without this a person building on the canvas has nothing to write.
 */
export function WorkflowStepReference({ stepId }: { stepId: string }) {
  const copy = useCoreI18n().richNodes;
  const [copied, setCopied] = useState(false);
  const reference = workflowStepReference(stepId);
  const copyReference = async () => {
    await navigator.clipboard.writeText(reference);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="grid gap-1.5 text-muted-foreground text-xs">
      {copy.stepReference}
      <div className="flex min-w-0 items-center gap-1">
        <code
          className="min-w-0 flex-1 truncate border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] text-foreground"
          data-workflow-step-reference=""
          title={reference}
        >
          {reference}
        </code>
        <Button
          aria-label={copy.copyStepReference}
          data-workflow-step-reference-copy=""
          onClick={() => void copyReference()}
          size="icon"
          title={copy.copyStepReference}
          type="button"
          variant="ghost"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}
