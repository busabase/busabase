import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Pressable, type PressableProps, StyleSheet, Text, View } from "react-native";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

type Variant = "primary" | "secondary" | "ghost" | "destructive";

interface ButtonProps extends Omit<PressableProps, "children"> {
  label: string;
  variant?: Variant;
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
}

export function Button({
  label,
  variant = "primary",
  loading,
  disabled,
  fullWidth,
  leadingIcon,
  style,
  onPress,
  ...rest
}: ButtonProps) {
  const tokens = useTokens();
  const isDisabled = disabled || loading;

  const handlePress: PressableProps["onPress"] = (event) => {
    // Primary/destructive are the state-changing actions (approve, merge,
    // delete, etc.) — every other variant is navigational/neutral.
    if (variant === "destructive") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else if (variant === "primary") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress?.(event);
  };

  const backgroundColor = (() => {
    if (isDisabled) return tokens.muted;
    if (variant === "primary") return tokens.primary;
    if (variant === "destructive") return tokens.destructive;
    if (variant === "secondary") return tokens.primaryMuted;
    return "transparent";
  })();

  const color = (() => {
    if (isDisabled) return tokens.mutedForeground;
    if (variant === "primary") return tokens.primaryForeground;
    if (variant === "destructive") return tokens.destructiveForeground;
    return tokens.foreground;
  })();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        {
          backgroundColor,
          opacity: state.pressed ? 0.82 : 1,
          width: fullWidth ? "100%" : undefined,
          borderColor:
            variant === "secondary" || variant === "ghost" ? tokens.border : "transparent",
          borderWidth:
            variant === "secondary" || variant === "ghost" ? StyleSheet.hairlineWidth : 0,
        },
        typeof style === "function" ? style(state) : style,
      ]}
      onPress={handlePress}
      {...rest}
    >
      <View style={styles.content}>
        {leadingIcon ? <View style={styles.icon}>{leadingIcon}</View> : null}
        <Text numberOfLines={2} style={[typography.bodyEm, styles.label, { color }]}>
          {loading ? "Loading..." : label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: mobile.minTouchTarget,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  icon: { flexShrink: 0 },
  label: { flexShrink: 1, minWidth: 0, textAlign: "center" },
});
