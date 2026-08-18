import * as Haptics from "expo-haptics";
import { Check, ChevronDown } from "lucide-react-native";
import type { ComponentType, ReactNode } from "react";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { NativeBottomSheet } from "./native-bottom-sheet";
import { NativeActionBar } from "./native-screen-states";
import { Button } from "./ui/Button";

interface NativeChoiceOption {
  id: string;
  name: string;
}

interface NativeChoicePickerProps {
  label: string;
  required?: boolean;
  choices: ReadonlyArray<NativeChoiceOption>;
  selected: string[];
  multiple?: boolean;
  onToggle: (id: string) => void;
  onClear: () => void;
}

export function NativeChoicePicker({
  label,
  required = false,
  choices,
  selected,
  multiple = false,
  onToggle,
  onClear,
}: NativeChoicePickerProps) {
  const tokens = useTokens();
  const [open, setOpen] = useState(false);
  const selectedChoices = choices.filter((choice) => selected.includes(choice.id));
  const summary =
    selectedChoices.length === 0
      ? multiple
        ? "Select options"
        : "Select an option"
      : selectedChoices.length === 1
        ? selectedChoices[0]?.name
        : `${selectedChoices.length} selected`;

  const clear = () => {
    onClear();
    setOpen(false);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${summary}`}
        accessibilityState={{ disabled: choices.length === 0, expanded: open }}
        disabled={choices.length === 0}
        style={({ pressed }) => [
          styles.choiceTrigger,
          {
            backgroundColor: tokens.muted,
            borderColor: open ? tokens.primary : tokens.border,
            opacity: choices.length === 0 ? 0.52 : pressed ? 0.72 : 1,
          },
        ]}
        onPress={() => setOpen(true)}
      >
        <Text
          numberOfLines={1}
          style={[typography.body, styles.choiceValue, { color: tokens.foreground }]}
        >
          {choices.length === 0 ? "No options" : summary}
        </Text>
        <ChevronDown size={18} color={tokens.mutedForeground} />
      </Pressable>

      <NativeBottomSheet
        visible={open}
        title={label}
        showCloseButton
        maxHeight="85%"
        onClose={() => setOpen(false)}
        footer={
          multiple || (!required && selected.length > 0) ? (
            <NativeActionBar>
              {multiple ? <Button label="Done" fullWidth onPress={() => setOpen(false)} /> : null}
              {!required && selected.length > 0 ? (
                <Button label="Clear selection" variant="ghost" fullWidth onPress={clear} />
              ) : null}
            </NativeActionBar>
          ) : undefined
        }
      >
        <ScrollView
          nestedScrollEnabled
          style={[styles.choiceOptions, { borderColor: tokens.border }]}
        >
          {choices.map((choice, index) => {
            const isSelected = selected.includes(choice.id);
            return (
              <Pressable
                key={choice.id}
                accessibilityRole={multiple ? "checkbox" : "radio"}
                accessibilityState={multiple ? { checked: isSelected } : { selected: isSelected }}
                style={({ pressed }) => [
                  styles.choiceOption,
                  index < choices.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderColor: tokens.border,
                  },
                  {
                    backgroundColor: isSelected ? tokens.primaryMuted : tokens.surface,
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}
                onPress={() => {
                  void Haptics.selectionAsync();
                  onToggle(choice.id);
                  if (!multiple) setOpen(false);
                }}
              >
                <Text
                  numberOfLines={2}
                  style={[typography.body, styles.choiceValue, { color: tokens.foreground }]}
                >
                  {choice.name}
                </Text>
                {isSelected ? <Check size={18} color={tokens.foreground} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </NativeBottomSheet>
    </>
  );
}

interface NativeChipOption<T extends string | null> {
  value: T;
  label: string;
  meta?: string | number;
}

interface NativeChipListProps<T extends string | null> {
  options: NativeChipOption<T>[];
  value: T;
  selectedValues?: T[];
  onChange: (value: T) => void;
}

export function NativeChipList<T extends string | null>({
  options,
  value,
  selectedValues,
  onChange,
}: NativeChipListProps<T>) {
  const tokens = useTokens();
  const selectedSet = new Set(selectedValues ?? []);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipsScroll}
      contentContainerStyle={styles.chipsContent}
    >
      {options.map((option) => {
        const active = option.value === value || selectedSet.has(option.value);
        return (
          <Pressable
            key={option.value ?? "null"}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.chip,
              {
                backgroundColor: active ? tokens.primaryMuted : tokens.card,
                borderColor: active ? tokens.primary : tokens.border,
              },
            ]}
            onPress={() => {
              void Haptics.selectionAsync();
              onChange(option.value);
            }}
          >
            <Text
              style={[
                typography.small,
                { color: active ? tokens.foreground : tokens.mutedForeground },
              ]}
            >
              {option.label}
            </Text>
            {option.meta !== undefined ? (
              <View
                style={[
                  styles.chipBadge,
                  { backgroundColor: active ? tokens.primary : tokens.muted },
                ]}
              >
                <Text
                  style={[
                    typography.caption,
                    { color: active ? tokens.primaryForeground : tokens.mutedForeground },
                  ]}
                >
                  {option.meta}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

interface NativeSegmentOption<T extends string> {
  value: T;
  label: string;
  meta?: string | number;
  icon?: ReactNode;
  Icon?: ComponentType<{ size?: number; color?: string }>;
}

interface NativeSegmentedControlProps<T extends string> {
  options: NativeSegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function NativeSegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: NativeSegmentedControlProps<T>) {
  const tokens = useTokens();

  return (
    <View style={[styles.segmented, { backgroundColor: tokens.muted, borderColor: tokens.border }]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.segment, { backgroundColor: active ? tokens.surface : "transparent" }]}
            onPress={() => {
              if (!active) {
                void Haptics.selectionAsync();
              }
              onChange(option.value);
            }}
          >
            {option.Icon ? (
              <option.Icon size={15} color={active ? tokens.foreground : tokens.mutedForeground} />
            ) : (
              option.icon
            )}
            <Text
              style={[
                typography.small,
                { color: active ? tokens.foreground : tokens.mutedForeground },
              ]}
            >
              {option.label}
            </Text>
            {option.meta !== undefined ? (
              <View
                style={[
                  styles.segmentBadge,
                  { backgroundColor: active ? tokens.primary : tokens.surface },
                ]}
              >
                <Text
                  style={[
                    typography.caption,
                    { color: active ? tokens.primaryForeground : tokens.mutedForeground },
                  ]}
                >
                  {option.meta}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  choiceTrigger: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  choiceValue: { flex: 1, minWidth: 0 },
  choiceOptions: {
    maxHeight: 360,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  choiceOption: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  chipsScroll: { flexGrow: 0 },
  chipsContent: { paddingHorizontal: spacing[5], gap: 8 },
  chip: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 10,
  },
  chipBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  segmented: {
    marginHorizontal: spacing[5],
    minHeight: 34,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 3,
    flexDirection: "row",
    gap: 3,
  },
  segment: {
    flex: 1,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  segmentBadge: {
    minWidth: 19,
    height: 19,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
});
