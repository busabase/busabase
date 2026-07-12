import { forwardRef } from "react";
import {
  TextInput as RNTextInput,
  type TextInputProps as RNTextInputProps,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { mobile, radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface TextInputProps extends RNTextInputProps {
  label?: string;
  error?: string;
}

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput(
  { label, error, style, ...rest },
  ref,
) {
  const tokens = useTokens();
  return (
    <View style={styles.field}>
      {label ? (
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>{label}</Text>
      ) : null}
      <RNTextInput
        ref={ref}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={tokens.mutedForeground}
        style={[
          styles.input,
          {
            color: tokens.foreground,
            backgroundColor: tokens.muted,
            borderColor: error ? tokens.destructive : tokens.border,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text style={[typography.small, { color: tokens.destructive }]}>{error}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: { gap: spacing[1] + 2 },
  input: {
    minHeight: mobile.minTouchTarget,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3] + 2,
    // Intentionally above typography.body (15) — 16px prevents iOS Safari/RN
    // WebView auto-zoom-on-focus.
    fontSize: 16,
  },
});
