import { Send, Square } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { TextInput } from "~/components/ui/TextInput";
import { mobile, radius, spacing } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface AcpComposerProps {
  disabled: boolean;
  sending: boolean;
  placeholder: string;
  onSend: (text: string) => void;
  /** Omitted when the port supplied no `cancel` — the stop button then doesn't render. */
  onStop?: () => void;
}

/**
 * The prompt box — mirrors `@acp-ui/web`'s `AcpComposer`: `onSend`/`disabled`/
 * `sending`/`placeholder` only, the host computes `disabled`/`placeholder`
 * from its own richer session state (see the chat screen).
 *
 * Text only for v1 — mobile has no attach-a-file affordance wired into the
 * composer yet, unlike web's image/audio/file picker.
 */
export function AcpComposer({ disabled, sending, placeholder, onSend, onStop }: AcpComposerProps) {
  const tokens = useTokens();
  const [text, setText] = useState("");

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    setText("");
    onSend(trimmed);
  };

  return (
    <View style={[styles.row, { borderColor: tokens.border }]}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        editable={!disabled}
        multiline
        containerStyle={styles.inputContainer}
        style={styles.input}
        returnKeyType="default"
      />
      {sending && onStop ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={mobile.hitSlop}
          onPress={onStop}
          style={({ pressed }) => [
            styles.sendButton,
            { backgroundColor: tokens.destructive, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Square
            size={16}
            color={tokens.destructiveForeground}
            fill={tokens.destructiveForeground}
          />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={disabled || text.trim().length === 0}
          hitSlop={mobile.hitSlop}
          onPress={send}
          style={({ pressed }) => [
            styles.sendButton,
            {
              backgroundColor: tokens.primary,
              opacity: disabled || text.trim().length === 0 ? 0.4 : pressed ? 0.8 : 1,
            },
          ]}
        >
          <Send size={16} color={tokens.primaryForeground} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputContainer: { flex: 1, marginBottom: 0 },
  input: { maxHeight: 120 },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
});
