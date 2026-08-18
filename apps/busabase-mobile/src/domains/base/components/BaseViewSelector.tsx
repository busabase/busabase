import { Check, ChevronDown } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { NativeBottomSheet } from "~/components/native-screen";
import { mobile, radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { BaseDetailController } from "../hooks/use-base-detail-controller";

interface Props {
  open: boolean;
  selectedId: string | null;
  selectedLabel: string;
  views: BaseDetailController["views"];
  onClose: () => void;
  onOpen: () => void;
  onSelect: (viewId: string | null) => void;
}

export function BaseViewSelector({
  open,
  selectedId,
  selectedLabel,
  views,
  onClose,
  onOpen,
  onSelect,
}: Props) {
  const tokens = useTokens();

  return (
    <>
      {views.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View: ${selectedLabel}`}
          accessibilityState={{ expanded: open }}
          style={({ pressed }) => [
            styles.viewTrigger,
            {
              backgroundColor: tokens.surface,
              borderColor: open ? tokens.primary : tokens.border,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
          onPress={onOpen}
        >
          <View style={styles.viewTriggerText}>
            <Text style={[typography.caption, { color: tokens.mutedForeground }]}>VIEW</Text>
            <Text numberOfLines={1} style={[typography.bodyEm, { color: tokens.foreground }]}>
              {selectedLabel}
            </Text>
          </View>
          <ChevronDown size={18} color={tokens.mutedForeground} />
        </Pressable>
      ) : null}

      <NativeBottomSheet
        visible={open}
        title="View"
        showCloseButton
        maxHeight="80%"
        onClose={onClose}
      >
        <ScrollView
          nestedScrollEnabled
          style={[styles.viewOptions, { borderColor: tokens.border }]}
        >
          {[{ id: null as string | null, name: "All" }, ...views].map((view, index, options) => {
            const selected = view.id === selectedId;
            return (
              <Pressable
                key={view.id ?? "all"}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.viewOption,
                  index < options.length - 1
                    ? { borderBottomWidth: StyleSheet.hairlineWidth }
                    : null,
                  {
                    backgroundColor: selected ? tokens.primaryMuted : tokens.surface,
                    borderColor: tokens.border,
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}
                onPress={() => onSelect(view.id)}
              >
                <Text
                  numberOfLines={1}
                  style={[typography.body, styles.viewOptionLabel, { color: tokens.foreground }]}
                >
                  {view.name}
                </Text>
                {selected ? <Check size={17} color={tokens.foreground} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </NativeBottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  viewTrigger: {
    minHeight: mobile.minTouchTarget,
    marginHorizontal: spacing[5],
    marginTop: spacing[3],
    marginBottom: spacing[2],
    paddingHorizontal: spacing[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  viewTriggerText: { flex: 1, minWidth: 0 },
  viewOptions: {
    maxHeight: 320,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  viewOption: {
    minHeight: mobile.minTouchTarget,
    paddingHorizontal: spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  viewOptionLabel: { flex: 1, minWidth: 0 },
});
