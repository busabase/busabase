import type { FormBoundFieldVO, FormFieldBindingVO } from "busabase-contract/types";
import { formatTimeZoneLabel } from "busabase-core/base/date-value";
import { iStringParse } from "openlib/i18n/i-string";
import { StyleSheet, Switch, Text, View } from "react-native";
import { NativeChoicePicker } from "~/components/native-screen";
import { TextInput } from "~/components/ui/TextInput";
import { dateFieldPlaceholder } from "~/domains/base/utils/date-input";
import { fmt, useI18n } from "~/i18n";
import { spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { formStringValue, getFormControlKind, getFormDateOptions } from "../utils/form-fields";

interface GeneratedFormFieldProps {
  binding: FormFieldBindingVO;
  field?: FormBoundFieldVO;
  last: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}

export function GeneratedFormField({
  binding,
  field,
  last,
  value,
  onChange,
}: GeneratedFormFieldProps) {
  const tokens = useTokens();
  const { t, locale } = useI18n();
  const kind = getFormControlKind(field);
  const dateOptions = kind === "date" ? getFormDateOptions(field) : null;
  const label = binding.label ?? (field ? iStringParse(field.name) : binding.fieldSlug);
  const selected = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string" && value
      ? [value]
      : [];
  const rowStyle = [
    styles.field,
    !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.border },
  ];
  const labelNode = (
    <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
      {label}
      {binding.required ? <Text style={{ color: tokens.destructive }}> *</Text> : null}
    </Text>
  );

  if (kind === "checkbox") {
    return (
      <View style={[...rowStyle, styles.checkboxRow]}>
        <View style={styles.copy}>
          {labelNode}
          {binding.help ? (
            <Text style={[typography.small, { color: tokens.mutedForeground }]}>
              {binding.help}
            </Text>
          ) : null}
        </View>
        <Switch
          accessibilityLabel={label}
          value={value === true}
          trackColor={{ true: tokens.primary }}
          onValueChange={onChange}
        />
      </View>
    );
  }

  return (
    <View style={rowStyle}>
      {labelNode}
      {kind === "select" || kind === "multiselect" ? (
        <NativeChoicePicker
          label={label}
          required={binding.required}
          choices={field?.choices ?? []}
          selected={selected}
          multiple={kind === "multiselect"}
          onToggle={(id) => {
            if (kind === "multiselect") {
              onChange(
                selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id],
              );
            } else {
              onChange(id);
            }
          }}
          onClear={() => onChange(kind === "multiselect" ? [] : "")}
        />
      ) : (
        <TextInput
          accessibilityLabel={label}
          value={formStringValue(value)}
          multiline={kind === "textarea"}
          keyboardType={
            kind === "number"
              ? "numeric"
              : kind === "email"
                ? "email-address"
                : kind === "tel"
                  ? "phone-pad"
                  : kind === "url"
                    ? "url"
                    : "default"
          }
          textAlignVertical={kind === "textarea" ? "top" : "center"}
          style={kind === "textarea" ? styles.multiline : undefined}
          placeholder={dateOptions ? dateFieldPlaceholder(dateOptions) : undefined}
          onChangeText={onChange}
        />
      )}
      {dateOptions?.includeTime ? (
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          {fmt(t.dateField.timeZoneHint, {
            zone: formatTimeZoneLabel(dateOptions.timezone, locale),
          })}
        </Text>
      ) : null}
      {binding.help ? (
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>{binding.help}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { paddingHorizontal: spacing[4], paddingVertical: spacing[3], gap: spacing[2] },
  checkboxRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  copy: { flex: 1, minWidth: 0, gap: spacing[1] },
  multiline: { minHeight: 96, paddingTop: 10 },
});
