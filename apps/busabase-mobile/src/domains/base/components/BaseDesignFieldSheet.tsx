import { Check, ChevronDown } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { NativeActionBar, NativeBottomSheet, NativeInlineError } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { BaseDesignController } from "../hooks/use-base-design-controller";
import { CREATABLE_FIELD_TYPES, isChoiceFieldType } from "../utils/base-design";
import { getFieldTypeLabel } from "../utils/field-type-label";

export function BaseDesignFieldSheet({ controller }: { controller: BaseDesignController }) {
  const tokens = useTokens();
  const mutation = controller.addFieldMutation;
  return (
    <NativeBottomSheet
      visible={controller.fieldSheetOpen && !controller.choicePendingRemove}
      title="Add field"
      showCloseButton
      maxHeight="88%"
      onClose={controller.closeFieldSheet}
      footer={
        <NativeActionBar>
          {mutation.error ? (
            <NativeInlineError message={mutation.error.message} onReset={mutation.reset} />
          ) : null}
          <Button
            label="Add field"
            loading={mutation.isPending}
            fullWidth
            onPress={() => mutation.mutate()}
          />
          <Button
            label="Cancel"
            variant="ghost"
            disabled={mutation.isPending}
            fullWidth
            onPress={controller.closeFieldSheet}
          />
        </NativeActionBar>
      }
    >
      <ScrollView
        style={styles.sheetScroll}
        contentContainerStyle={styles.sheetForm}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          label="Name"
          value={controller.fieldName}
          onChangeText={controller.updateFieldName}
        />
        <TextInput
          label="Slug"
          value={controller.fieldSlug}
          onChangeText={controller.updateFieldSlug}
        />
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>Type</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Type: ${getFieldTypeLabel(controller.fieldType)}`}
          accessibilityState={{ expanded: controller.fieldTypePickerOpen }}
          style={({ pressed }) => [
            styles.selectTrigger,
            {
              backgroundColor: tokens.muted,
              borderColor: controller.fieldTypePickerOpen ? tokens.primary : tokens.border,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
          onPress={() => controller.setFieldTypePickerOpen(!controller.fieldTypePickerOpen)}
        >
          <Text
            numberOfLines={1}
            style={[typography.body, styles.selectValue, { color: tokens.foreground }]}
          >
            {getFieldTypeLabel(controller.fieldType)}
          </Text>
          <ChevronDown size={18} color={tokens.mutedForeground} />
        </Pressable>
        {controller.fieldTypePickerOpen ? (
          <ScrollView
            nestedScrollEnabled
            style={[styles.selectOptions, { borderColor: tokens.border }]}
          >
            {CREATABLE_FIELD_TYPES.map((type) => {
              const selected = type === controller.fieldType;
              return (
                <Pressable
                  key={type}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.selectOption,
                    {
                      backgroundColor: selected ? tokens.primaryMuted : tokens.surface,
                      borderColor: tokens.border,
                      opacity: pressed ? 0.72 : 1,
                    },
                  ]}
                  onPress={() => {
                    controller.setFieldType(type);
                    controller.setFieldTypePickerOpen(false);
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={[typography.body, styles.selectValue, { color: tokens.foreground }]}
                  >
                    {getFieldTypeLabel(type)}
                  </Text>
                  {selected ? <Check size={17} color={tokens.foreground} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {isChoiceFieldType(controller.fieldType) ? (
          <View style={styles.choices}>
            <Text style={[typography.small, { color: tokens.mutedForeground }]}>Choices</Text>
            <View style={styles.chips}>
              {controller.choices.map((choice) => (
                <Pressable
                  key={choice}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${choice}`}
                  style={[
                    styles.chip,
                    { backgroundColor: tokens.primaryMuted, borderColor: tokens.primary },
                  ]}
                  onPress={() => controller.setChoicePendingRemove(choice)}
                >
                  <Text style={[typography.small, { color: tokens.foreground }]}>{choice}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.choiceRow}>
              <View style={styles.choiceInput}>
                <TextInput
                  value={controller.choiceDraft}
                  placeholder="Add a choice"
                  returnKeyType="done"
                  onChangeText={controller.setChoiceDraft}
                  onSubmitEditing={controller.addChoice}
                />
              </View>
              <Button label="Add" variant="secondary" onPress={controller.addChoice} />
            </View>
          </View>
        ) : null}

        <View style={styles.requiredRow}>
          <Text style={[typography.body, { color: tokens.foreground }]}>Required</Text>
          <Switch
            accessibilityLabel="Required"
            value={controller.required}
            trackColor={{ true: tokens.primary }}
            onValueChange={controller.setRequired}
          />
        </View>
      </ScrollView>
    </NativeBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetScroll: { maxHeight: 460 },
  sheetForm: { gap: 12, paddingBottom: 8 },
  selectTrigger: {
    minHeight: mobile.minTouchTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  selectValue: { flex: 1, minWidth: 0 },
  selectOptions: {
    maxHeight: 220,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  selectOption: {
    minHeight: mobile.minTouchTarget,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  choices: { gap: 8 },
  choiceRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  choiceInput: { flex: 1 },
  requiredRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
