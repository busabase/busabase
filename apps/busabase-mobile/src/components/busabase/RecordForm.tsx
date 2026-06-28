import type { BaseFieldVO } from "busabase-core/types";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { isEditableField, type RecordFormValue } from "~/lib/record-form";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { TextInput } from "../ui/TextInput";

interface RecordFormProps {
  fields: BaseFieldVO[];
  values: Record<string, RecordFormValue>;
  onChange: (slug: string, value: RecordFormValue) => void;
}

const MULTILINE_TYPES = new Set(["longtext", "markdown", "html"]);

function ChoiceChips({
  choices,
  selected,
  multiple,
  onToggle,
}: {
  choices: NonNullable<BaseFieldVO["options"]["choices"]>;
  selected: string[];
  multiple: boolean;
  onToggle: (id: string) => void;
}) {
  const tokens = useTokens();
  return (
    <View style={styles.chips}>
      {choices.map((choice) => {
        const active = selected.includes(choice.id);
        return (
          <Pressable
            key={choice.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.chip,
              {
                backgroundColor: active ? tokens.primaryMuted : tokens.surface,
                borderColor: active ? tokens.primary : tokens.border,
              },
            ]}
            onPress={() => onToggle(choice.id)}
          >
            <Text
              style={[
                typography.small,
                { color: active ? tokens.foreground : tokens.mutedForeground },
              ]}
            >
              {multiple ? choice.name : choice.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: BaseFieldVO;
  value: RecordFormValue;
  onChange: (value: RecordFormValue) => void;
}) {
  const tokens = useTokens();
  const meta = (
    <View style={styles.meta}>
      <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
        {field.name}
        {field.required ? <Text style={{ color: tokens.destructive }}> *</Text> : null}
      </Text>
      <Text style={[typography.caption, { color: tokens.mutedForeground }]}>{field.type}</Text>
    </View>
  );

  if (!isEditableField(field)) {
    return (
      <View style={[styles.field, { borderColor: tokens.border }]}>
        {meta}
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          Managed by the server — edit on web if needed.
        </Text>
      </View>
    );
  }

  if (field.type === "checkbox") {
    return (
      <View style={[styles.field, styles.checkboxRow, { borderColor: tokens.border }]}>
        {meta}
        <Switch
          value={value === true}
          trackColor={{ true: tokens.primary }}
          onValueChange={(next) => onChange(next)}
        />
      </View>
    );
  }

  if (field.type === "select" || field.type === "multiselect") {
    const choices = field.options.choices ?? [];
    const selected = Array.isArray(value) ? value : value ? [String(value)] : [];
    const multiple = field.type === "multiselect";
    return (
      <View style={[styles.field, { borderColor: tokens.border }]}>
        {meta}
        <ChoiceChips
          choices={choices}
          selected={selected}
          multiple={multiple}
          onToggle={(id) => {
            if (multiple) {
              onChange(
                selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id],
              );
            } else {
              onChange(selected[0] === id ? "" : id);
            }
          }}
        />
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
          : field.type === "url"
            ? "url"
            : "default";

  return (
    <View style={[styles.field, { borderColor: tokens.border }]}>
      {meta}
      <TextInput
        value={typeof value === "string" ? value : ""}
        multiline={multiline}
        keyboardType={keyboardType}
        textAlignVertical={multiline ? "top" : "center"}
        style={multiline ? styles.multiline : undefined}
        placeholder={field.type === "date" ? "YYYY-MM-DD" : undefined}
        onChangeText={(next) => onChange(next)}
      />
    </View>
  );
}

export function RecordForm({ fields, values, onChange }: RecordFormProps) {
  return (
    <View style={styles.list}>
      {fields.map((field) => (
        <FieldRow
          key={field.id}
          field={field}
          value={values[field.slug] ?? ""}
          onChange={(next) => onChange(field.slug, next)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  field: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
    gap: 8,
  },
  meta: { gap: 2 },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  multiline: { minHeight: 96, paddingTop: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
