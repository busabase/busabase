import { Check, ChevronDown } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface WebhookSelectOption<T extends string> {
  value: T;
  label: string;
}

interface WebhookSelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: WebhookSelectOption<T>[];
  expanded: boolean;
  onToggle: () => void;
  onChange: (value: T) => void;
}

export function WebhookSelectField<T extends string>({
  label,
  value,
  options,
  expanded,
  onToggle,
  onChange,
}: WebhookSelectFieldProps<T>) {
  const tokens = useTokens();
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  return (
    <>
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selectedLabel}`}
        accessibilityState={{ expanded }}
        style={({ pressed }) => [
          styles.trigger,
          {
            backgroundColor: tokens.muted,
            borderColor: expanded ? tokens.primary : tokens.border,
            opacity: pressed ? 0.72 : 1,
          },
        ]}
        onPress={onToggle}
      >
        <Text
          numberOfLines={1}
          style={[typography.body, styles.value, { color: tokens.foreground }]}
        >
          {selectedLabel}
        </Text>
        <ChevronDown size={18} color={tokens.mutedForeground} />
      </Pressable>
      {expanded ? (
        <ScrollView nestedScrollEnabled style={[styles.options, { borderColor: tokens.border }]}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.option,
                  {
                    backgroundColor: selected ? tokens.primaryMuted : tokens.surface,
                    borderColor: tokens.border,
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}
                onPress={() => onChange(option.value)}
              >
                <Text
                  numberOfLines={1}
                  style={[typography.body, styles.value, { color: tokens.foreground }]}
                >
                  {option.label}
                </Text>
                {selected ? <Check size={17} color={tokens.foreground} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: mobile.minTouchTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  value: { flex: 1, minWidth: 0 },
  options: { maxHeight: 220, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  option: {
    minHeight: mobile.minTouchTarget,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
