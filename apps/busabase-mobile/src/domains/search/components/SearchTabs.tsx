import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { mobile, radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { SearchTab, SearchTabOption } from "../types/search";

interface SearchTabsProps {
  options: SearchTabOption[];
  selected: SearchTab;
  onSelect: (tab: SearchTab) => void;
}

export function SearchTabs({ options, selected, onSelect }: SearchTabsProps) {
  const tokens = useTokens();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.tabs, { borderColor: tokens.border }]}
      contentContainerStyle={styles.content}
    >
      {options.map((option) => {
        const active = option.value === selected;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.tab,
              {
                backgroundColor: active ? tokens.primaryMuted : "transparent",
                opacity: pressed ? 0.68 : 1,
              },
            ]}
            onPress={() => onSelect(option.value)}
          >
            <Text
              style={[
                typography.small,
                styles.label,
                { color: active ? tokens.foreground : tokens.mutedForeground },
              ]}
            >
              {option.label}
            </Text>
            {option.meta !== undefined ? (
              <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                {option.meta}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexGrow: 0,
    marginBottom: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: {
    minHeight: mobile.minTouchTarget,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[2],
    gap: spacing[1],
  },
  tab: {
    minHeight: 32,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
  },
  label: { fontWeight: "600" },
});
