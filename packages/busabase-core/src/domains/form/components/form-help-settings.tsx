"use client";

import { useMutation } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { FormVO } from "busabase-contract/types";
import { Button } from "kui/button";
import { useEffect, useState } from "react";
import { useCoreI18n, useCoreLocale, useIString } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { FieldHelp } from "../../dashboard/components/field-help";

/** Per-form overrides never modify the source Base field. Empty hides the description. */
export function FormHelpSettings({
  form,
  orpc,
  onSaved,
}: {
  form: FormVO;
  orpc: BusabaseQueryUtils;
  onSaved: () => Promise<unknown>;
}) {
  return <FormHelpSettingsDraft key={form.nodeId} form={form} orpc={orpc} onSaved={onSaved} />;
}

function FormHelpSettingsDraft({
  form,
  orpc,
  onSaved,
}: {
  form: FormVO;
  orpc: BusabaseQueryUtils;
  onSaved: () => Promise<unknown>;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const resolveIString = useIString();
  // Store only edited help values: every other binding property comes from the latest form.
  // Map.has distinguishes inheriting (undefined) from intentionally hiding help ("").
  const [helpEdits, setHelpEdits] = useState(new Map<string, string | undefined>());
  const [refreshError, setRefreshError] = useState<unknown>(null);
  useEffect(() => {
    const inputNames = new Set(form.bindings.map((binding) => binding.inputName));
    setHelpEdits((current) => {
      if ([...current.keys()].every((inputName) => inputNames.has(inputName))) return current;
      return new Map([...current].filter(([inputName]) => inputNames.has(inputName)));
    });
  }, [form.bindings]);
  const bindings = form.bindings.map((binding) =>
    helpEdits.has(binding.inputName)
      ? { ...binding, help: helpEdits.get(binding.inputName) }
      : binding,
  );
  const hasChanges = bindings.some((binding, index) => binding.help !== form.bindings[index]?.help);
  const update = useMutation(orpc.forms.update.mutationOptions());
  const change = (inputName: string, help: string | undefined) =>
    setHelpEdits((current) => {
      const next = new Map(current);
      if (help === form.bindings.find((binding) => binding.inputName === inputName)?.help) {
        next.delete(inputName);
      } else {
        next.set(inputName, help);
      }
      return next;
    });
  const save = async () => {
    try {
      await update.mutateAsync({ nodeId: form.nodeId, bindings });
      setHelpEdits(new Map());
      await refresh();
    } catch {
      // Keep the editable drafts; the mutation error is rendered below.
    }
  };
  const refresh = async () => {
    setRefreshError(null);
    try {
      await onSaved();
    } catch (error) {
      setRefreshError(error);
    }
  };
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <p className="text-muted-foreground text-sm">{messages.fieldHelp.publicHint}</p>
      {bindings.map((binding) => {
        const field = form.boundFields.find((candidate) => candidate.slug === binding.fieldSlug);
        const label = binding.label
          ? resolveIString(binding.label)
          : field
            ? resolveIString(field.name)
            : binding.inputName;
        const custom = binding.help !== undefined;
        const inputId = `form-help-${binding.inputName}`;
        return (
          <div className="space-y-2 rounded-md border border-border/60 p-4" key={binding.inputName}>
            <div className="font-medium text-sm">{label}</div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={custom}
                disabled={update.isPending}
                onChange={(event) =>
                  change(
                    binding.inputName,
                    event.target.checked ? (field?.help?.description ?? "") : undefined,
                  )
                }
              />
              {messages.fieldHelp.override}
            </label>
            {custom ? (
              <>
                <label className="text-muted-foreground text-xs" htmlFor={inputId}>
                  {messages.fieldHelp.description}
                </label>
                <textarea
                  id={inputId}
                  className="w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                  rows={3}
                  maxLength={1000}
                  value={binding.help ?? ""}
                  disabled={update.isPending}
                  onChange={(event) => change(binding.inputName, event.target.value)}
                />
              </>
            ) : (
              <p className="text-muted-foreground text-xs">{messages.fieldHelp.inherit}</p>
            )}
            <div className="rounded-md bg-muted/30 p-3">
              <span className="text-xs">{messages.fieldHelp.preview}</span>
              <FieldHelp
                help={{
                  description: binding.help ?? field?.help?.description,
                  example: field?.help?.example,
                }}
              />
            </div>
          </div>
        );
      })}
      {update.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {presentCoreError(messages, locale, update.error, messages.fieldHelp.saveFailed)}
        </p>
      ) : null}
      {refreshError ? (
        <div role="alert" className="space-y-2 text-destructive text-sm">
          <p>{presentCoreError(messages, locale, refreshError, messages.inbox.loadFailedBody)}</p>
          <Button type="button" variant="outline" onClick={() => void refresh()}>
            {messages.inbox.retry}
          </Button>
        </div>
      ) : null}
      <Button type="button" disabled={update.isPending || !hasChanges} onClick={() => void save()}>
        {update.isPending ? messages.common.submitting : messages.fieldHelp.save}
      </Button>
    </div>
  );
}
