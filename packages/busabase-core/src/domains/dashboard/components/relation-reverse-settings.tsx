"use client";

import type { BaseVO, BaseFieldVO as FieldVO } from "busabase-contract/types";
import { fmt, useCoreI18n, useIString } from "../../../i18n";
import { isReverseRelationDef } from "../../base/field-types";

export interface ReverseColumnDraft {
  enabled: boolean;
  name: string;
}

/** The live reverse column of `forwardField` on `targetBase`, if one exists. */
export const findReverseColumn = (forwardField: FieldVO, targetBase: BaseVO | undefined) =>
  targetBase?.fields.find(
    (field) => isReverseRelationDef(field) && field.options.reverseOfFieldId === forwardField.id,
  ) ?? null;

interface Props {
  /** The Base the dialog edits. */
  base: BaseVO;
  bases: BaseVO[];
  disabled?: boolean;
  /** Edit mode: the relation field being edited. Absent when adding a field. */
  field?: FieldVO | null;
  onChange: (value: ReverseColumnDraft) => void;
  targetBaseId: string;
  value: ReverseColumnDraft;
}

/**
 * Create a corresponding two-way field on the other Base. The switch belongs
 * to this relation field, not to every relation between the pair of Bases.
 * Turning it on creates a reverse column on the target Base; both sides stay
 * editable and in sync because the links are stored once. Links within one
 * Base get no switch.
 */
export function RelationReverseSettings(props: Props) {
  const { base, bases, disabled, field, onChange, targetBaseId, value } = props;
  const messages = useCoreI18n();
  const resolveIString = useIString();
  if (field && isReverseRelationDef(field)) {
    const forwardBase = bases.find((item) => item.id === field.options.targetBaseId);
    const forwardField = forwardBase?.fields.find(
      (item) => item.id === field.options.reverseOfFieldId,
    );
    return (
      <p className="mt-4 rounded-md bg-muted/40 px-3 py-2 text-muted-foreground text-xs">
        {fmt(messages.reverseRelation.otherSideOf, {
          base: forwardBase?.name ?? "",
          field: forwardField ? resolveIString(forwardField.name) : "",
        })}
      </p>
    );
  }
  if (!targetBaseId || targetBaseId === base.id) return null;
  const targetBase = bases.find((item) => item.id === targetBaseId);
  if (!targetBase) return null;
  const existing = field ? findReverseColumn(field, targetBase) : null;
  if (existing) {
    return (
      <p className="mt-4 rounded-md bg-muted/40 px-3 py-2 text-muted-foreground text-xs">
        {fmt(messages.reverseRelation.shownInBaseAs, {
          base: targetBase.name,
          field: resolveIString(existing.name),
        })}
      </p>
    );
  }
  return (
    <div className="mt-4 rounded-md border border-border/60 px-3 py-2.5">
      <label className="flex items-center gap-2 text-sm">
        <input
          checked={value.enabled}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
          type="checkbox"
        />
        {fmt(messages.reverseRelation.showInBase, { base: targetBase.name })}
      </label>
      {value.enabled ? (
        <label className="mt-2 block pl-6">
          <span className="text-muted-foreground text-xs">
            {fmt(messages.reverseRelation.columnNameInBase, { base: targetBase.name })}
          </span>
          <input
            className="mt-1 h-8 w-full rounded-md border border-border/70 bg-card px-2.5 text-sm outline-none transition-colors focus:border-primary"
            disabled={disabled}
            onChange={(event) => onChange({ ...value, name: event.target.value })}
            value={value.name}
          />
        </label>
      ) : null}
      <p className="mt-1.5 pl-6 text-muted-foreground text-xs">
        {value.enabled
          ? messages.reverseRelation.syncHint
          : fmt(messages.reverseRelation.oneWayHint, {
              base: base.name,
              target: targetBase.name,
            })}
      </p>
    </div>
  );
}
