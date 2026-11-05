"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { fmt, useCoreI18n } from "../../../i18n";

interface Props {
  id: string;
  orpc: BusabaseQueryUtils;
  /** `""` means any Base in the space. */
  value: string;
  onChange: (baseId: string) => void;
  /** What the empty choice says. Defaults to "Any base", for a trigger filter. */
  emptyLabel?: string;
}

/** Picks a Base: the filter on a record-event trigger, or where a new record goes. */
export function WorkflowTriggerBasePicker({ id, orpc, value, onChange, emptyLabel }: Props) {
  const messages = useCoreI18n();
  const basesQuery = useQuery(orpc.bases.list.queryOptions({ input: {} }));
  const bases = basesQuery.data ?? [];
  const missing = value !== "" && !bases.some((base) => base.id === value);
  return (
    <label className="grid gap-1.5 text-muted-foreground text-xs" htmlFor={id}>
      {messages.richNodes.triggerBase}
      <select
        className="h-9 border border-input bg-card px-3 text-foreground text-sm"
        data-workflow-trigger-base=""
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">{emptyLabel ?? messages.richNodes.anyBase}</option>
        {bases.map((base) => (
          <option key={base.id} value={base.id}>
            {base.name}
          </option>
        ))}
        {/* Keep a saved Base the list no longer has (deleted, or not loaded
            yet) selectable instead of silently showing "Any base". */}
        {missing ? (
          <option value={value}>{fmt(messages.richNodes.unknownBase, { id: value })}</option>
        ) : null}
      </select>
    </label>
  );
}
