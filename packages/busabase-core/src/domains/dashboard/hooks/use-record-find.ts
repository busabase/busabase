import type { listRecordsPageInputSchema } from "busabase-contract/domains/base/contract/record-schemas";
import { useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import type { RecordFindState } from "../helpers/record-find-url";

export const RECORD_FIND_DEBOUNCE_MS = 500;
export type RecordFindInput = NonNullable<z.input<typeof listRecordsPageInputSchema>["find"]>;

export function useRecordFind({
  value,
  scope,
  onCommit,
}: {
  value: RecordFindState;
  scope: string | null;
  onCommit: (value: RecordFindState) => void;
}) {
  const key = JSON.stringify([scope, value.query, value.fieldId]);
  const [draft, setDraft] = useState(() => ({ ...value, key, composing: false }));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  if (draft.key !== key) {
    cancel();
    composing.current = false;
    setDraft({ ...value, key, composing: false });
  }
  const query = draft.query.trim();
  // An empty find only prepares a field choice; it does not change the collection.
  const isPending =
    draft.composing || query !== value.query || (Boolean(query) && draft.fieldId !== value.fieldId);
  const input = useMemo<RecordFindInput | undefined>(
    () =>
      value.query
        ? { query: value.query, ...(value.fieldId ? { fieldId: value.fieldId } : {}) }
        : undefined,
    [value.query, value.fieldId],
  );
  useEffect(() => {
    if (!scope || draft.key !== key || !isPending || draft.composing) return;
    timer.current = setTimeout(() => {
      if (!composing.current) onCommit({ query: draft.query.trim(), fieldId: draft.fieldId });
      timer.current = null;
    }, RECORD_FIND_DEBOUNCE_MS);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [draft, isPending, key, onCommit, scope]);

  return {
    input,
    query: draft.query,
    fieldId: draft.fieldId,
    hasQuery: Boolean(value.query),
    isPending,
    setQuery: (query: string) => {
      cancel();
      setDraft((current) => ({ ...current, query }));
    },
    setFieldId: (fieldId: string) => {
      cancel();
      setDraft((current) => ({ ...current, fieldId }));
    },
    startComposition: () => {
      cancel();
      composing.current = true;
      setDraft((current) => ({ ...current, composing: true }));
    },
    endComposition: (query: string) => {
      if (!composing.current) return;
      composing.current = false;
      setDraft((current) => ({ ...current, query, composing: false }));
    },
    clear: () => {
      cancel();
      composing.current = false;
      setDraft((current) => ({ ...current, query: "", composing: false }));
      onCommit({ query: "", fieldId: draft.fieldId });
    },
  };
}

export type RecordFindControl = ReturnType<typeof useRecordFind> & {
  isFetching?: boolean;
};
