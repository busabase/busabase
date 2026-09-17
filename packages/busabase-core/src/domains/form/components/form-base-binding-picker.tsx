"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Checkbox } from "kui/checkbox";
import { useCoreI18n, useIString } from "../../../i18n";
import { isHiddenOnCreate } from "../../base/field-types";

/**
 * What a Form needs before it can exist: the Base it writes into, and which of
 * that Base's fields it collects.
 *
 * `busabase_forms.target_base_id` is NOT NULL, so this pair is not a setting —
 * it is the create input. One component rather than two because BOTH surfaces
 * that can bring a Form to life ask for exactly the same thing: the New-item
 * dialog's Form tile (before the node exists) and the Form detail view's
 * "not set up yet" empty state (after it exists but was never bound). Two copies
 * of this picker would be two places for the field filter below to drift.
 */
export interface FormBindingDraft {
  targetBaseId: string;
  /** Base field slugs to collect. The binding's `inputName` mirrors the slug. */
  fieldSlugs: string[];
}

interface FormBaseBindingPickerProps {
  orpc: BusabaseQueryUtils;
  value: FormBindingDraft;
  onChange: (value: FormBindingDraft) => void;
  disabled?: boolean;
  /** Prefix for the generated control ids, so two pickers can coexist on a page. */
  idPrefix?: string;
}

/** `{ inputName, fieldSlug }` pairs for `forms.create` / the node_create metadata. */
export const toFormBindings = (draft: FormBindingDraft) =>
  draft.fieldSlugs.map((slug) => ({ inputName: slug, fieldSlug: slug }));

export function FormBaseBindingPicker({
  orpc,
  value,
  onChange,
  disabled = false,
  idPrefix = "form-binding",
}: FormBaseBindingPickerProps) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  // `BaseVO` already carries its `fields`, so choosing a Base needs no second
  // request — the checklist below renders from the same response.
  const basesQuery = useQuery(orpc.bases.list.queryOptions({ input: {} }));
  const bases = basesQuery.data ?? [];
  const selectedBase = bases.find((base) => base.id === value.targetBaseId) ?? null;
  // System- and AI-computed fields are stripped from record input server-side, so
  // offering them here would let someone build a form whose controls can never
  // write anything. Same predicate the record create form uses.
  const bindableFields = (selectedBase?.fields ?? []).filter(
    (field) => !isHiddenOnCreate(field.type),
  );

  const selectBase = (baseId: string) => {
    const base = bases.find((candidate) => candidate.id === baseId) ?? null;
    // Pre-check the required fields: a form that silently omits one produces
    // submissions the target Base will reject.
    const defaults = (base?.fields ?? [])
      .filter((field) => !isHiddenOnCreate(field.type) && field.required)
      .map((field) => field.slug);
    onChange({ targetBaseId: baseId, fieldSlugs: defaults });
  };

  const toggleField = (slug: string, checked: boolean) => {
    onChange({
      ...value,
      fieldSlugs: checked
        ? [...value.fieldSlugs, slug]
        : value.fieldSlugs.filter((current) => current !== slug),
    });
  };

  if (basesQuery.isPending) {
    return <p className="text-muted-foreground text-sm">{messages.common.loading}</p>;
  }

  if (basesQuery.isError) {
    return (
      <div className="rounded-md border border-rejected/35 bg-rejected/17 px-3 py-2 text-rejected-strong text-sm">
        {messages.form.basesFailed}
      </div>
    );
  }

  if (bases.length === 0) {
    return <p className="text-muted-foreground text-sm">{messages.form.noBases}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 text-sm">
        <label className="text-muted-foreground" htmlFor={`${idPrefix}-target-base`}>
          {messages.form.targetBase}
        </label>
        <select
          className="h-8 w-full rounded-md border border-border/70 bg-card px-2.5 text-sm outline-none transition-colors focus:border-primary disabled:opacity-50"
          disabled={disabled}
          id={`${idPrefix}-target-base`}
          onChange={(event) => selectBase(event.target.value)}
          value={value.targetBaseId}
        >
          <option value="">{messages.form.targetBasePlaceholder}</option>
          {bases.map((base) => (
            <option key={base.id} value={base.id}>
              {base.name}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground text-xs">{messages.form.targetBaseHelp}</span>
      </div>

      {selectedBase ? (
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted-foreground">{messages.form.collectFields}</span>
          {bindableFields.length === 0 ? (
            <span className="text-muted-foreground text-xs">{messages.common.noFields}</span>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-md border border-border/60">
              {bindableFields.map((field) => {
                const checked = value.fieldSlugs.includes(field.slug);
                return (
                  <label
                    className="flex min-h-10 cursor-pointer items-center gap-2.5 border-border/40 border-b px-2.5 py-2 text-sm transition-colors last:border-b-0 hover:bg-muted/35"
                    htmlFor={`${idPrefix}-field-${field.slug}`}
                    key={field.id}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      id={`${idPrefix}-field-${field.slug}`}
                      onCheckedChange={(next) => toggleField(field.slug, next === true)}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium text-foreground">
                        {resolveIString(field.name)}
                      </span>
                      <span className="truncate font-mono text-muted-foreground text-xs">
                        {field.slug}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-md bg-muted/55 px-2 py-0.5 text-muted-foreground text-xs">
                      {messages.fieldTypes[field.type]}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
