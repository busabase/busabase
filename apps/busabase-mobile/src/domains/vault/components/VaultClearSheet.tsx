import { Trash2 } from "lucide-react-native";
import { NativeActionBar, NativeBottomSheet, NativeInlineError } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useI18n } from "~/i18n";
import { useTokens } from "~/theme/use-tokens";

interface Props {
  error: Error | null;
  pending: boolean;
  visible: boolean;
  onClear: () => void;
  onClose: () => void;
  onResetError: () => void;
}

export function VaultClearSheet({
  error,
  pending,
  visible,
  onClear,
  onClose,
  onResetError,
}: Props) {
  const tokens = useTokens();
  const { t } = useI18n();

  return (
    <NativeBottomSheet
      visible={visible}
      title="Clear vault?"
      description="This removes every secret and variable stored on this server. This cannot be undone."
      showCloseButton
      onClose={onClose}
      footer={
        <NativeActionBar>
          {error ? <NativeInlineError message={error.message} onReset={onResetError} /> : null}
          <Button
            label="Clear vault"
            variant="destructive"
            loading={pending}
            fullWidth
            leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
            onPress={onClear}
          />
          <Button
            label={t.common.cancel}
            variant="ghost"
            disabled={pending}
            fullWidth
            onPress={onClose}
          />
        </NativeActionBar>
      }
    />
  );
}
