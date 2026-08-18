import type { WebhookRuleVO } from "busabase-contract/domains/webhook/types";
import { Trash2 } from "lucide-react-native";
import { NativeActionBar, NativeBottomSheet, NativeInlineError } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useI18n } from "~/i18n";
import { useTokens } from "~/theme/use-tokens";

interface Props {
  rule: WebhookRuleVO | null;
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onConfirm: () => void;
  onResetError: () => void;
}

export function WebhookDeleteSheet({
  rule,
  pending,
  error,
  onClose,
  onConfirm,
  onResetError,
}: Props) {
  const { t } = useI18n();
  const tokens = useTokens();

  return (
    <NativeBottomSheet
      visible={!!rule}
      title="Delete rule?"
      description={
        rule ? `This permanently removes "${rule.name}". This cannot be undone.` : undefined
      }
      showCloseButton
      onClose={onClose}
      footer={
        <NativeActionBar>
          {error ? <NativeInlineError message={error.message} onReset={onResetError} /> : null}
          <Button
            label="Delete rule"
            variant="destructive"
            loading={pending}
            fullWidth
            leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
            onPress={onConfirm}
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
