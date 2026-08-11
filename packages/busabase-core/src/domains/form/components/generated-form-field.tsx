import type { FormBoundFieldVO, FormFieldBindingVO } from "busabase-contract/types";
import { type FieldInputKind, fieldInputKind } from "../../base/field-types";

interface GeneratedFormFieldProps {
  binding: FormFieldBindingVO;
  field?: FormBoundFieldVO;
  label: string;
  onChange: (value: unknown) => void;
  value: unknown;
}

const controlClassName =
  "mt-1.5 w-full rounded-md border border-border/70 bg-card px-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15";

const stringValue = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

export const generatedFormControlKind = (field?: FormBoundFieldVO): FieldInputKind =>
  field ? fieldInputKind(field.type) : "text";

export function GeneratedFormField({
  binding,
  field,
  label,
  onChange,
  value,
}: GeneratedFormFieldProps) {
  const controlKind = generatedFormControlKind(field);
  const inputId = `form-field-${binding.inputName}`;
  const sharedProps = {
    "data-input-name": binding.inputName,
    id: inputId,
  };

  const control =
    controlKind === "textarea" ? (
      <textarea
        {...sharedProps}
        aria-label={label}
        className={`${controlClassName} min-h-16 resize-y py-2 leading-5`}
        onChange={(event) => onChange(event.target.value)}
        value={stringValue(value)}
      />
    ) : controlKind === "checkbox" ? (
      <div className="mt-1.5 flex h-9 items-center">
        <input
          {...sharedProps}
          aria-label={label}
          checked={value === true}
          className="size-4 rounded border-border text-primary accent-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
      </div>
    ) : controlKind === "select" ? (
      <select
        {...sharedProps}
        aria-label={label}
        className={`${controlClassName} h-9`}
        onChange={(event) => onChange(event.target.value)}
        value={stringValue(value)}
      >
        <option value="">-</option>
        {(field?.choices ?? []).map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>
    ) : controlKind === "multiselect" ? (
      <select
        {...sharedProps}
        aria-label={label}
        className={`${controlClassName} min-h-20 py-2`}
        multiple
        onChange={(event) =>
          onChange(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))
        }
        value={
          Array.isArray(value)
            ? value.filter((item): item is string => typeof item === "string")
            : []
        }
      >
        {(field?.choices ?? []).map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>
    ) : (
      <input
        {...sharedProps}
        aria-label={label}
        className={`${controlClassName} h-9`}
        onChange={(event) =>
          onChange(
            controlKind === "number" && event.target.value !== ""
              ? event.target.valueAsNumber
              : event.target.value,
          )
        }
        type={
          controlKind === "number" ||
          controlKind === "date" ||
          controlKind === "url" ||
          controlKind === "email" ||
          controlKind === "tel"
            ? controlKind
            : "text"
        }
        value={stringValue(value)}
      />
    );

  return (
    <div className="min-w-0">
      <label className="block font-medium text-foreground text-sm" htmlFor={inputId}>
        {label}
        {binding.required ? <span className="ml-0.5 text-rejected-strong">*</span> : null}
      </label>
      {control}
    </div>
  );
}
