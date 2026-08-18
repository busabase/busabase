import type { BaseFieldVO } from "busabase-contract/types";
import { iStringParse } from "openlib/i18n/i-string";
import { NativeChoicePicker } from "~/components/native-screen";
import type { RecordFormValue } from "../utils/record-form";

interface RecordChoiceFieldProps {
  field: BaseFieldVO;
  value: RecordFormValue;
  onChange: (value: RecordFormValue) => void;
}

export function RecordChoiceField({ field, value, onChange }: RecordChoiceFieldProps) {
  const choices = field.options.choices ?? [];
  const selected = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : value
      ? [String(value)]
      : [];
  const multiple = field.type === "multiselect";

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
          onChange(id);
        }
      }}
      onClear={() => onChange(multiple ? [] : "")}
    />
  );
}
