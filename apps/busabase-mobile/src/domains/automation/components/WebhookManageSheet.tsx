import type { WebhookDeliveryVO, WebhookRuleVO } from "busabase-contract/domains/webhook/types";
import { Pencil, Zap } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import {
  NativeActionBar,
  NativeActionItem,
  NativeActionRow,
  NativeBottomSheet,
  NativeLoadingState,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useI18n } from "~/i18n";
import { formatListTime } from "~/lib/format";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import {
  getWebhookActionKindLabel,
  getWebhookDeliveryStatusLabel,
  getWebhookEventTypeLabel,
} from "../utils/webhook-form";

interface WebhookManageSheetProps {
  rule: WebhookRuleVO | null;
  deliveries: WebhookDeliveryVO[];
  deliveriesLoading: boolean;
  deliveriesError: boolean;
  testMessage: string | null;
  testPending: boolean;
  onClose: () => void;
  onTest: (id: string) => void;
  onEdit: (rule: WebhookRuleVO) => void;
  onDelete: (id: string) => void;
}

export function WebhookManageSheet({
  rule,
  deliveries,
  deliveriesLoading,
  deliveriesError,
  testMessage,
  testPending,
  onClose,
  onTest,
  onEdit,
  onDelete,
}: WebhookManageSheetProps) {
  const tokens = useTokens();
  const { t } = useI18n();

  return (
    <NativeBottomSheet
      visible={!!rule}
      title={rule?.name}
      description={
        rule
          ? `${getWebhookEventTypeLabel(rule.eventType)} · ${getWebhookActionKindLabel(rule.actionKind)}`
          : undefined
      }
      showCloseButton
      onClose={onClose}
      footer={
        rule ? (
          <NativeActionBar>
            {testMessage ? (
              <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                {testMessage}
              </Text>
            ) : null}
            <NativeActionRow>
              <NativeActionItem>
                <Button
                  label="Test fire"
                  variant="secondary"
                  loading={testPending}
                  leadingIcon={<Zap size={18} color={tokens.foreground} />}
                  onPress={() => onTest(rule.id)}
                />
              </NativeActionItem>
              <NativeActionItem>
                <Button
                  label={t.common.edit}
                  variant="secondary"
                  leadingIcon={<Pencil size={18} color={tokens.foreground} />}
                  onPress={() => onEdit(rule)}
                />
              </NativeActionItem>
            </NativeActionRow>
            <Button label="Delete rule" variant="destructive" onPress={() => onDelete(rule.id)} />
          </NativeActionBar>
        ) : undefined
      }
    >
      {rule ? (
        <View style={styles.body}>
          <Text style={[typography.caption, styles.label, { color: tokens.mutedForeground }]}>
            Recent deliveries
          </Text>
          {deliveriesLoading ? <NativeLoadingState label="Loading" /> : null}
          {deliveriesError ? (
            <Text style={[typography.small, { color: tokens.destructive }]}>
              Could not load delivery history.
            </Text>
          ) : null}
          {!deliveriesLoading && !deliveriesError && deliveries.length === 0 ? (
            <Text style={[typography.small, { color: tokens.mutedForeground }]}>
              No deliveries yet.
            </Text>
          ) : null}
          {deliveries.map((delivery) => (
            <View key={delivery.id} style={[styles.delivery, { borderColor: tokens.border }]}>
              <Text
                style={[
                  typography.small,
                  {
                    color:
                      delivery.status === "success"
                        ? tokens.merged.text
                        : delivery.status === "failed"
                          ? tokens.destructive
                          : tokens.mutedForeground,
                  },
                ]}
              >
                {getWebhookDeliveryStatusLabel(delivery.status)}
              </Text>
              {delivery.httpStatus !== null ? (
                <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                  {delivery.httpStatus}
                </Text>
              ) : null}
              <Text style={[typography.caption, styles.time, { color: tokens.mutedForeground }]}>
                {formatListTime(delivery.createdAt)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </NativeBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 8 },
  label: { textTransform: "uppercase" },
  delivery: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  time: { marginLeft: "auto" },
});
