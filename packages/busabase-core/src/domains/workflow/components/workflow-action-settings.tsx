"use client";

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  WORKFLOW_CREATE_RECORD_ACTION,
  WORKFLOW_DELETE_RECORD_ACTION,
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
    default:
      return actionName;
  }
};

const KNOWN_ACTIONS: readonly string[] = [
  WORKFLOW_READ_RECORD_ACTION,
  WORKFLOW_UPDATE_RECORD_ACTION,
  WORKFLOW_CREATE_RECORD_ACTION,
  WORKFLOW_DELETE_RECORD_ACTION,
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

interface WorkflowActionSettingsProps {
  orpc: BusabaseQueryUtils;
  stepId: string;
  actionName: string;
  fields: Record<string, unknown>;
  targetRecordId: string;
  baseId: string;
  onChange: (patch: {
    actionName?: string;
    fields?: Record<string, unknown>;
    targetRecordId?: string;
    baseId?: string;
  }) => void;
}

/** What an action step does, and the settings that action needs. */
export function WorkflowActionSettings({
  orpc,
  stepId,
  actionName,
  fields,
  targetRecordId,
  baseId,
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
