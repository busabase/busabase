import { forwardRef } from "react";
import {
  TextInput as RNTextInput,
  type TextInputProps as RNTextInputProps,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { radius, typography } from "~/theme/tokens";
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
            backgroundColor: tokens.surface,
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
  field: { gap: 6 },
  input: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontSize: 16,
  },
});
