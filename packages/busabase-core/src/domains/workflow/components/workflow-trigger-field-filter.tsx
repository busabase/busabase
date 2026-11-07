"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Input } from "kui/input";
import { useCoreI18n, useIString } from "../../../i18n";

interface Props {
  orpc: BusabaseQueryUtils;
  /** The trigger's Base. A field filter needs one: "any Base" has no fields to pick. */
  baseId: string;
  value: { fieldSlug: string; toValue: string };
  onChange: (value: { fieldSlug: string; toValue: string }) => void;
}

/**
 * "Only when this field changes (to …)" on a record trigger. A select field
 * offers its choices, a checkbox offers checked or not, and any other field
 * takes the value as text.
 */
export function WorkflowTriggerFieldFilter({ orpc, baseId, value, onChange }: Props) {
  const messages = useCoreI18n();
  const text = useIString();
  const basesQuery = useQuery({
    ...orpc.bases.list.queryOptions({ input: {} }),
    enabled: baseId !== "",
  });
  if (!baseId) {
    return (
      <p
        className="text-[11px] leading-snug text-muted-foreground/80"
        data-workflow-trigger-field-needs-base=""
      >
        {messages.richNodes.triggerFieldNeedsBase}
      </p>
    );
  }
  const fields = basesQuery.data?.find((base) => base.id === baseId)?.fields ?? [];
  const field = fields.find((candidate) => candidate.slug === value.fieldSlug);
  const choices =
    field && (field.type === "select" || field.type === "multiselect")
      ? (field.options.choices ?? [])
      : null;
  const fieldMissing = value.fieldSlug !== "" && !field && basesQuery.isSuccess;

  return (
    <>
      <label
        className="grid gap-1.5 text-muted-foreground text-xs"
        htmlFor="rich-node-trigger-field"
      >
        {messages.richNodes.triggerField}
        <select
          className="h-9 border border-input bg-card px-3 text-foreground text-sm"
          data-workflow-trigger-field=""
          id="rich-node-trigger-field"
          onChange={(event) => onChange({ fieldSlug: event.target.value, toValue: "" })}
          value={value.fieldSlug}
        >
          <option value="">{messages.richNodes.anyField}</option>
          {fields.map((candidate) => (
            <option key={candidate.id} value={candidate.slug}>
              {text(candidate.name)}
            </option>
          ))}
          {fieldMissing ? <option value={value.fieldSlug}>{value.fieldSlug}</option> : null}
        </select>
      </label>
      {value.fieldSlug ? (
        <label
          className="grid gap-1.5 text-muted-foreground text-xs"
          htmlFor="rich-node-trigger-to-value"
        >
          {messages.richNodes.triggerToValue}
          {choices || field?.type === "checkbox" ? (
            <select
              className="h-9 border border-input bg-card px-3 text-foreground text-sm"
              data-workflow-trigger-to-value=""
              id="rich-node-trigger-to-value"
              onChange={(event) => onChange({ ...value, toValue: event.target.value })}
              value={value.toValue}
            >
              <option value="">{messages.richNodes.anyValue}</option>
              {choices
                ? choices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {text(choice.name)}
                    </option>
                  ))
                : [
                    <option key="true" value="true">
                      {messages.richNodes.checkboxChecked}
                    </option>,
                    <option key="false" value="false">
                      {messages.richNodes.checkboxUnchecked}
                    </option>,
                  ]}
            </select>
          ) : (
            <Input
              data-workflow-trigger-to-value=""
              id="rich-node-trigger-to-value"
              onChange={(event) => onChange({ ...value, toValue: event.target.value })}
              placeholder={messages.richNodes.anyValue}
              value={value.toValue}
            />
          )}
          <span className="text-[11px] leading-snug text-muted-foreground/80">
            {messages.richNodes.triggerFieldHint}
          </span>
        </label>
      ) : null}
    </>
  );
}
