import { useQueries, useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { BaseFieldVO, BaseVO, LookupRollup } from "busabase-contract/types";
import { LOOKUP_SOURCE_LIMIT } from "busabase-contract/types";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "kui/command";
import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import { Check, ChevronsUpDown, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useCoreI18n, useIString } from "../../../i18n";
import { applyRollup, isRollupCompatible, LOOKUP_ROLLUPS } from "../../base/lookup/rollup";
import { getRecordTitle } from "../helpers/change-request";
import { getRelationRecordIds } from "../helpers/field";
import { emptyLookupValues, lookupDisplayField, lookupItemValue } from "../helpers/lookup";
import { FieldValuePreview } from "./field-preview";

export type LookupConfigDraft = {
  relationFieldSlug: string;
  targetFieldSlug: string;
  rollup: LookupRollup;
  limit?: "all" | "first";
};

function LookupFieldPicker({
  label,
  placeholder,
  fields,
  value,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  placeholder: string;
  fields: BaseFieldVO[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  testId: string;
}) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const [open, setOpen] = useState(false);
  const selected = fields.find((field) => field.slug === value);
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground text-xs" id={`${testId}-label`}>
        {label}
      </span>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <button
            aria-expanded={open}
            aria-labelledby={`${testId}-label`}
            className="mt-1 flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-border/70 bg-card px-2.5 text-left text-sm disabled:opacity-50"
            data-testid={testId}
            disabled={disabled}
            role="combobox"
            type="button"
          >
            <span className="truncate">
              {selected ? resolveIString(selected.name) : placeholder}
            </span>
            <ChevronsUpDown className="shrink-0 text-muted-foreground" size={14} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
        >
          <Command>
            <CommandInput placeholder={messages.lookup.search} />
            <CommandList>
              <CommandEmpty>{messages.lookup.noMatches}</CommandEmpty>
              {fields.map((field) => (
                <CommandItem
                  key={field.id}
                  onSelect={() => {
                    onChange(field.slug);
                    setOpen(false);
                  }}
                  value={`${resolveIString(field.name)} ${field.slug}`}
                >
                  <Check className={value === field.slug ? "opacity-100" : "opacity-0"} size={14} />
                  <span className="min-w-0 flex-1 truncate">{resolveIString(field.name)}</span>
                  <span className="text-muted-foreground text-xs">
                    {messages.fieldTypes[field.type]}
                  </span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function LookupFieldConfig({
  base,
  bases,
  value,
  onChange,
  orpc,
  disabled,
  mode,
  onCreateRelation,
}: {
  base: BaseVO;
  bases: BaseVO[];
  value: LookupConfigDraft;
  onChange: (value: LookupConfigDraft) => void;
  orpc: BusabaseQueryUtils;
  disabled?: boolean;
  mode: "add" | "edit";
  onCreateRelation?: () => void;
}) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const relations = base.fields.filter(
    (field) => field.type === "relation" && field.options.targetBaseId,
  );
  const relation = relations.find((field) => field.slug === value.relationFieldSlug);
  // The catalog only contains link metadata. Fetch the selected Base's full
  // schema, but only while it is still present in the accessible catalog.
  const catalogTarget = bases.find((item) => item.id === relation?.options.targetBaseId);
  const targetBaseQuery = useQuery({
    ...orpc.bases.get.queryOptions({ input: { baseId: catalogTarget?.id ?? "" } }),
    enabled: Boolean(catalogTarget),
    retry: false,
  });
  const targetBase =
    catalogTarget && !targetBaseQuery.error && targetBaseQuery.data?.id === catalogTarget.id
      ? targetBaseQuery.data
      : undefined;
  const targets = (targetBase?.fields ?? []).filter((field) => field.type !== "lookup");
  const target = targets.find((field) => field.slug === value.targetFieldSlug);
  const aggregate = value.rollup !== "values";
  const sampleQuery = useQuery({
    ...orpc.records.listPage.queryOptions({ input: { baseId: base.id, page: 1, pageSize: 3 } }),
    enabled: Boolean(target),
    retry: false,
  });
  const samples = target ? (sampleQuery.data?.records ?? []) : [];
  // Never aggregate a partial sample: a bounded preview skips large relations
  // instead of presenting a plausible but incomplete total.
  const previewSamples = samples.filter(
    (record) =>
      value.limit === "first" ||
      getRelationRecordIds(record.headCommit.payload[value.relationFieldSlug]).length <=
        LOOKUP_SOURCE_LIMIT,
  );
  const ids = [
    ...new Set(
      previewSamples.flatMap((record) => {
        const ids = getRelationRecordIds(record.headCommit.payload[value.relationFieldSlug]);
        return value.limit === "first" ? ids.slice(0, 1) : ids;
      }),
    ),
  ];
  const targetQueries = useQueries({
    queries: ids.map((recordId) => ({
      ...orpc.records.get.queryOptions({ input: { recordId } }),
      retry: false,
    })),
  });
  const targetRecords = new Map(
    targetQueries.flatMap((query) => (query.data ? [[query.data.id, query.data] as const] : [])),
  );
  const failed = Boolean(sampleQuery.error) || targetQueries.some((query) => query.error);
  const loading = sampleQuery.isFetching || targetQueries.some((query) => query.isPending);
  const prefix = `${mode}-field-lookup`;
  const rollups = target
    ? LOOKUP_ROLLUPS.filter(
        (rollup) => rollup !== "values" && isRollupCompatible(rollup, target.type),
      )
    : [];
  const resultField = target ? lookupDisplayField(target, value.rollup) : undefined;
  return (
    <div className="grid min-w-0 gap-3" data-testid={`${prefix}-config`}>
      <LookupFieldPicker
        disabled={disabled}
        fields={relations}
        label={messages.base.lookupVia}
        onChange={(relationFieldSlug) => {
          onChange({ ...value, relationFieldSlug, targetFieldSlug: "", rollup: "values" });
        }}
        placeholder={messages.base.lookupSelectRelation}
        testId={`${prefix}-relation`}
        value={value.relationFieldSlug}
      />
      {relations.length === 0 ? (
        <div className="text-muted-foreground text-xs">
          {messages.base.lookupNeedsRelationField}
          {onCreateRelation ? (
            <button
              className="mt-2 flex items-center gap-1 text-primary hover:underline"
              disabled={disabled}
              onClick={onCreateRelation}
              type="button"
            >
              <Plus size={13} />
              {messages.lookup.createRelation}
            </button>
          ) : null}
        </div>
      ) : null}
      {relation && (!catalogTarget || targetBaseQuery.error) ? (
        <p className="text-muted-foreground text-xs" role="status">
          {messages.lookup.inaccessible}
        </p>
      ) : null}
      {catalogTarget && targetBaseQuery.isPending ? (
        <p className="text-muted-foreground text-xs" role="status">
          {messages.common.loading}
        </p>
      ) : null}
      {(value.relationFieldSlug && !relation) ||
      (targetBase && value.targetFieldSlug && !target) ? (
        <p className="text-muted-foreground text-xs" role="status">
          {messages.lookup.invalid}
        </p>
      ) : null}
      {targetBase ? (
        <div className="truncate text-muted-foreground text-xs">
          {messages.lookup.source}: {targetBase.name}
        </div>
      ) : null}
      <LookupFieldPicker
        disabled={disabled || !targetBase}
        fields={targets}
        label={messages.base.lookupTargetField}
        onChange={(targetFieldSlug) => {
          onChange({ ...value, targetFieldSlug, rollup: "values" });
        }}
        placeholder={messages.base.lookupSelectTargetField}
        testId={`${prefix}-target`}
        value={value.targetFieldSlug}
      />
      <fieldset className="flex flex-wrap gap-4" disabled={disabled || !target}>
        <legend className="sr-only">{messages.base.lookupRollup}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={!aggregate}
            name={`${prefix}-mode`}
            onChange={() => {
              onChange({ ...value, rollup: "values" });
            }}
            type="radio"
          />
          {messages.lookup.values}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={aggregate}
            name={`${prefix}-mode`}
            onChange={() => {
              onChange({ ...value, rollup: rollups[0] ?? "count" });
            }}
            type="radio"
          />
          {messages.lookup.aggregate}
        </label>
      </fieldset>
      {aggregate ? (
        <label className="block text-muted-foreground text-xs">
          {messages.base.lookupRollup}
          <select
            className="mt-1 h-9 w-full rounded-md border border-border/70 bg-card px-2.5 text-foreground text-sm"
            data-testid={`${prefix}-rollup`}
            disabled={disabled || !target}
            onChange={(event) => onChange({ ...value, rollup: event.target.value as LookupRollup })}
            value={value.rollup}
          >
            {rollups.map((rollup) => (
              <option key={rollup} value={rollup}>
                {messages.lookup[rollup]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {target && resultField ? (
        <section className="min-w-0 border-border/50 border-t pt-3" data-testid="lookup-preview">
          <div className="mb-2 text-muted-foreground text-xs">{messages.lookup.preview}</div>
          {failed ? (
            <div className="flex items-center gap-2 text-sm" role="alert">
              {messages.lookup.failed}
              <button
                aria-label={messages.lookup.retry}
                className="p-1 hover:bg-accent"
                onClick={() => {
                  void sampleQuery.refetch();
                  for (const query of targetQueries) void query.refetch();
                }}
                title={messages.lookup.retry}
                type="button"
              >
                <RotateCcw size={14} />
              </button>
            </div>
          ) : loading ? (
            <span className="text-muted-foreground text-xs">{messages.common.loading}</span>
          ) : samples.length === 0 ? (
            <span className="text-muted-foreground text-xs">{messages.lookup.noSample}</span>
          ) : (
            samples.map((record) => {
              const allIds = getRelationRecordIds(
                record.headCommit.payload[value.relationFieldSlug],
              );
              const sampleIds = value.limit === "first" ? allIds.slice(0, 1) : allIds;
              if (sampleIds.length > LOOKUP_SOURCE_LIMIT)
                return (
                  <div
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 py-2 text-sm"
                    key={record.id}
                  >
                    <span className="truncate text-muted-foreground">
                      {getRecordTitle(record, messages)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {messages.lookup.previewLimit}
                    </span>
                  </div>
                );
              const unavailable = sampleIds.some(
                (id) => !targetRecords.has(id) || targetRecords.get(id)?.baseId !== targetBase?.id,
              );
              const raw = sampleIds.map(
                (id) => targetRecords.get(id)?.headCommit.payload[value.targetFieldSlug],
              );
              const result = applyRollup(raw, value.rollup);
              const users = Object.assign(
                {},
                ...sampleIds.map((id) => targetRecords.get(id)?.fieldUsers ?? {}),
              );
              return (
                <div
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start gap-3 border-border/30 border-b py-2 text-sm last:border-0"
                  key={record.id}
                >
                  <span
                    className="truncate text-muted-foreground"
                    title={getRecordTitle(record, messages)}
                  >
                    {getRecordTitle(record, messages)}
                  </span>
                  <div className="min-w-0">
                    {unavailable ? (
                      messages.lookup.inaccessible
                    ) : sampleIds.length === 0 || emptyLookupValues(raw) ? (
                      <div className="flex flex-wrap gap-1">
                        {typeof result === "number" ? (
                          <FieldValuePreview field={resultField} value={result} />
                        ) : null}
                        <span className="text-muted-foreground text-xs">
                          {sampleIds.length === 0
                            ? messages.lookup.unlinked
                            : messages.lookup.empty}
                        </span>
                      </div>
                    ) : value.rollup === "values" && Array.isArray(result) ? (
                      <div className="flex min-w-0 flex-wrap gap-1">
                        {result.map((item, i) => (
                          <FieldValuePreview
                            field={target}
                            fieldUsers={users}
                            key={`${target.id}:${i}`}
                            value={lookupItemValue(target, item)}
                          />
                        ))}
                      </div>
                    ) : (
                      <FieldValuePreview field={resultField} fieldUsers={users} value={result} />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </section>
      ) : null}
      {target ? <span className="sr-only">{resolveIString(target.name)}</span> : null}
    </div>
  );
}
