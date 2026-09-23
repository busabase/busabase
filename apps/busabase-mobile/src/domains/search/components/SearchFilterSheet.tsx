import { Check } from "lucide-react-native";
import { Pressable, StyleSheet, Text } from "react-native";
import { NativeActionBar, NativeBottomSheet, NativeSection } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { mobile, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import {
  DATE_PRESET_OPTIONS,
  EMPTY_SEARCH_FILTERS,
  hasActiveFilters,
  SEARCH_SORT_OPTIONS,
  type SearchFilters,
} from "../utils/search-filters";

interface SearchFilterSheetProps {
  visible: boolean;
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  onClose: () => void;
}

/**
 * Sort and date range, as a sheet rather than a row of controls.
 *
 * The web page puts five filters on screen at once; a phone has room for the
 * query and the results. Author is deliberately absent here — it is set by
 * tapping the author on a result, because the stored value is a free-form actor
 * id nobody can usefully type. Subtree is absent for the same kind of reason:
 * choosing a node is a tree browser, not a control.
 */
export function SearchFilterSheet({ visible, filters, onChange, onClose }: SearchFilterSheetProps) {
  const tokens = useTokens();

  const row = (label: string, selected: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      hitSlop={mobile.hitSlop}
      style={({ pressed }) => [styles.option, { opacity: pressed ? 0.72 : 1 }]}
      onPress={onPress}
    >
      <Text
        style={[
          selected ? typography.bodyEm : typography.body,
          styles.optionLabel,
          { color: tokens.foreground },
        ]}
      >
        {label}
      </Text>
      {selected ? <Check size={18} color={tokens.primary} /> : null}
    </Pressable>
  );

  return (
    <NativeBottomSheet
      visible={visible}
      title="Filters"
      showCloseButton
      onClose={onClose}
      footer={
        <NativeActionBar>
          <Button
            label="Clear all"
            variant="secondary"
            disabled={!hasActiveFilters(filters)}
            fullWidth
            onPress={() => onChange(EMPTY_SEARCH_FILTERS)}
          />
        </NativeActionBar>
      }
    >
      <NativeSection title="Sort">
        {SEARCH_SORT_OPTIONS.map((option) =>
          row(option.label, filters.sort === option.value, () =>
            onChange({ ...filters, sort: option.value }),
          ),
        )}
      </NativeSection>
      <NativeSection title="Updated">
        {DATE_PRESET_OPTIONS.map((option) =>
          row(option.label, filters.datePreset === option.value, () =>
            onChange({ ...filters, datePreset: option.value }),
          ),
        )}
      </NativeSection>
    </NativeBottomSheet>
  );
}

const styles = StyleSheet.create({
  option: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  optionLabel: { flex: 1, minWidth: 0 },
});
