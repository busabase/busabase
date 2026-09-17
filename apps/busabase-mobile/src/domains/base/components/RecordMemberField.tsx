import { skipToken, useQuery } from "@tanstack/react-query";
import type { BaseFieldVO } from "busabase-contract/types";
import { formatMemberChipLabel } from "busabase-core/dashboard/format";
import { iStringParse } from "openlib/i18n/i-string";
import { useMemo } from "react";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { NativeChoicePicker } from "~/components/native-screen";
import type { RecordFormValue } from "../utils/record-form";

/**
 * Assigning a `member` field from a phone.
 *
 * `relation` is deliberately NOT editable on mobile, and `member` is, which
 * looks inconsistent until you look at what each one needs: a relation picker
 * has to search an entire Base, while a member picker is a short flat roster —
 * exactly what `NativeChoicePicker` already is. Assignment on the go ("give this
 * to me / to her, from my phone") is also the strongest reason this field type
 * exists at all, so leaving it read-only here would be half a feature.
 */
export function RecordMemberField({
  field,
  value,
  onChange,
}: {
  field: BaseFieldVO;
  value: RecordFormValue;
  onChange: (value: RecordFormValue) => void;
}) {
  const busabase = useBusabaseOrpc();
  const multiple = field.options.multiple !== false;

  const rosterQuery = useQuery(
    busabase
      ? busabase.orpc.spaces.members.queryOptions({
          input: {},
          // An anonymous / Embed connection is denied this by design (it is not
          // on the anonymous allowlist); that means "no roster", not an error.
          retry: false,
          staleTime: 60_000,
        })
      : { queryKey: ["no-connection", "spaces", "members"], queryFn: skipToken },
  );

  const selected = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string" && value
      ? [value]
      : [];

  const choices = useMemo(() => {
    const roster = rosterQuery.data ?? [];
    const byId = new Map(roster.map((user) => [user.id, user]));
    // A person already set on the record stays selectable even when they have
    // left the space, so opening the editor cannot silently drop them.
    const orphans = selected
      .filter((id) => !byId.has(id))
      .map((id) => ({ id, name: formatMemberChipLabel(undefined, id) }));
    return [
      ...orphans,
      ...roster.map((user) => ({ id: user.id, name: formatMemberChipLabel(user, user.id) })),
    ];
  }, [rosterQuery.data, selected]);

  return (
    <NativeChoicePicker
      label={iStringParse(field.name)}
      required={field.required}
      choices={choices}
      selected={selected}
      multiple={multiple}
      onToggle={(id) => {
        if (multiple) {
          onChange(
            selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id],
          );
        } else {
          // A single-member field stores a scalar, never a one-element array.
          onChange(selected[0] === id ? "" : id);
        }
      }}
      onClear={() => onChange(multiple ? [] : "")}
    />
  );
}
