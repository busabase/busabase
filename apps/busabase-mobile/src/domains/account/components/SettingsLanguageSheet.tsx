import { Check } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { NativeBottomSheet } from "~/components/native-screen";
import type { LocalePreference } from "~/i18n";
import { mobile, radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { SettingsLanguageOption } from "../types/settings";

interface SettingsLanguageSheetProps {
  visible: boolean;
  title: string;
  preference: LocalePreference;
  options: SettingsLanguageOption[];
  onSelect: (preference: LocalePreference) => void;
  onClose: () => void;
}

export function SettingsLanguageSheet({
  visible,
  title,
  preference,
  options,
  onSelect,
  onClose,
}: SettingsLanguageSheetProps) {
  const tokens = useTokens();

  return (
    <NativeBottomSheet visible={visible} title={title} showCloseButton onClose={onClose}>
      <ScrollView
        nestedScrollEnabled
        style={[styles.languageOptions, { borderColor: tokens.border }]}
      >
        {options.map((option, index) => {
          const selected = option.value === preference;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.languageOption,
                index < options.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth } : null,
                {
                  backgroundColor: selected ? tokens.primaryMuted : tokens.surface,
                  borderColor: tokens.border,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
              onPress={() => onSelect(option.value)}
            >
              <Text
                numberOfLines={1}
                style={[typography.body, styles.languageOptionLabel, { color: tokens.foreground }]}
              >
                {option.label}
              </Text>
              {selected ? <Check size={17} color={tokens.foreground} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </NativeBottomSheet>
  );
}

const styles = StyleSheet.create({
  languageOptions: {
    maxHeight: 240,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  languageOption: {
    minHeight: mobile.minTouchTarget,
    paddingHorizontal: spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  languageOptionLabel: { flex: 1, minWidth: 0 },
});
