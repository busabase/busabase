import type { BaseFieldVO } from "busabase-contract/types";
import { useEffect, useState } from "react";
import {
  buildInitialFormValues,
  getChangedFieldValues,
  normalizeFormValues,
  type RecordFormValue,
  recordFormValuesEqual,
} from "../utils/record-form";

interface RecordFormDraft {
  identity: string;
  fields: BaseFieldVO[];
  source: Record<string, unknown>;
  initialValues: Record<string, RecordFormValue>;
  values: Record<string, RecordFormValue>;
  schemaChanged: boolean;
}

const EMPTY_SOURCE: Record<string, unknown> = {};
const EMPTY_VALUES: Record<string, RecordFormValue> = {};

export function useRecordFormDraft({
  identity,
  fields,
  source = EMPTY_SOURCE,
}: {
  identity: string;
  fields: BaseFieldVO[] | undefined;
  source?: Record<string, unknown>;
}) {
  const [draft, setDraft] = useState<RecordFormDraft | null>(null);

  useEffect(() => {
    if (!fields) return;
    setDraft((previous) => {
      const initialValues = buildInitialFormValues(fields, source);
      if (!previous || previous.identity !== identity) {
        return {
          identity,
          fields,
          source,
          initialValues,
          values: initialValues,
          schemaChanged: false,
        };
      }
      const changedSlugs = previous.fields
        .filter((field) => !recordFormValuesEqual([field], previous.initialValues, previous.values))
        .map((field) => field.slug);
      const schemaChanged = changedSlugs.some((slug) => {
        const before = previous.fields.find((field) => field.slug === slug);
        const next = fields.find((field) => field.slug === slug);
        return (
          !next ||
          before?.id !== next.id ||
          before?.type !== next.type ||
          JSON.stringify(before?.options) !== JSON.stringify(next.options)
        );
      });
      if (previous.schemaChanged || schemaChanged) {
        return { ...previous, schemaChanged: true };
      }
      const values = { ...initialValues };
      for (const slug of changedSlugs) values[slug] = previous.values[slug];
      return { identity, fields, source, initialValues, values, schemaChanged: false };
    });
  }, [fields, identity, source]);

  const current = draft?.identity === identity ? draft : null;
  const values = current?.values ?? EMPTY_VALUES;
  const initialValues = current?.initialValues ?? EMPTY_VALUES;
  const draftFields = current?.fields ?? fields ?? [];
  return {
    values,
    fields: draftFields,
    schemaChanged: current?.schemaChanged ?? false,
    hasChanges: !recordFormValuesEqual(draftFields, initialValues, values),
    changedValues: getChangedFieldValues(
      normalizeFormValues(draftFields, initialValues, current?.source),
      normalizeFormValues(draftFields, values, current?.source),
    ),
    setValue: (slug: string, value: RecordFormValue) =>
      setDraft((previous) =>
        previous?.identity === identity
          ? { ...previous, values: { ...previous.values, [slug]: value } }
          : previous,
      ),
  };
}
