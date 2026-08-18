import type { AssetAttachmentRef, BaseFieldVO } from "busabase-contract/types";
import { iStringParse } from "openlib/i18n/i-string";
import { StyleSheet, Switch, Text, View } from "react-native";
import { TextInput } from "~/components/ui/TextInput";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { RecordFormValue } from "../utils/record-form";
import { RecordAttachmentField } from "./RecordAttachmentField";
import { RecordChoiceField } from "./RecordChoiceField";

interface RecordFieldRowProps {
  field: BaseFieldVO;
  value: RecordFormValue;
  onChange: (value: RecordFormValue) => void;
  last: boolean;
  layout?: "full" | "left" | "right";
}

const MULTILINE_TYPES = new Set(["longtext", "markdown", "html"]);

export function RecordFieldRow({ field, value, onChange, last, layout }: RecordFieldRowProps) {
  const tokens = useTokens();
  const rowStyle = [
    styles.field,
    layout === "full" ? styles.fieldFull : null,
    layout === "left" || layout === "right" ? styles.fieldHalf : null,
    layout === "left"
      ? { borderRightWidth: StyleSheet.hairlineWidth, borderColor: tokens.border }
      : null,
    !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.border },
  ];
  const fieldLabel = iStringParse(field.name);
  const label = (
    <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
      {fieldLabel}
      {field.required ? <Text style={{ color: tokens.destructive }}> *</Text> : null}
    </Text>
  );

  if (field.type === "checkbox") {
    return (
      <View style={[...rowStyle, styles.checkboxRow]}>
        {label}
        <Switch
          accessibilityLabel={fieldLabel}
          value={value === true}
          trackColor={{ true: tokens.primary }}
          onValueChange={(next) => onChange(next)}
        />
      </View>
    );
  }

  if (field.type === "attachment") {
    const refs = Array.isArray(value)
      ? value.filter(
          (item): item is AssetAttachmentRef => typeof item === "object" && item !== null,
        )
      : [];
    return (
      <View style={rowStyle}>
        {label}
        <RecordAttachmentField field={field} refs={refs} onChange={onChange} />
      </View>
    );
  }

  if (field.type === "select" || field.type === "multiselect") {
    return (
      <View style={rowStyle}>
        {label}
        <RecordChoiceField field={field} value={value} onChange={onChange} />
      </View>
    );
  }

  const multiline = MULTILINE_TYPES.has(field.type);
  const keyboardType =
    field.type === "number"
      ? "numeric"
      : field.type === "email"
        ? "email-address"
        : field.type === "phone"
          ? "phone-pad"
          : field.type === "url" || field.type === "embed"
            ? "url"
            : "default";

  return (
    <View style={rowStyle}>
      {label}
      <TextInput
        accessibilityLabel={fieldLabel}
        value={typeof value === "string" ? value : ""}
        multiline={multiline}
        keyboardType={keyboardType}
        textAlignVertical={multiline ? "top" : "center"}
        style={multiline ? styles.multiline : undefined}
        placeholder={field.type === "date" ? "YYYY-MM-DD" : undefined}
        onChangeText={onChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  fieldFull: { width: "100%" },
  fieldHalf: { width: "50%" },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  multiline: { minHeight: 96, paddingTop: 10 },
});
