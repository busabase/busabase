import { ArrowLeft, Plus, Webhook as WebhookIcon } from "lucide-react-native";
import { Pressable, Switch } from "react-native";
import {
  NativeErrorState,
  NativeLoadingState,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { mobile } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { useWebhookSettingsController } from "../hooks/use-webhook-settings-controller";
import {
  getWebhookActionKindLabel,
  getWebhookEventTypeLabel,
  getWebhookRuleMeta,
} from "../utils/webhook-form";
import { WebhookDeleteSheet } from "./WebhookDeleteSheet";
import { WebhookManageSheet } from "./WebhookManageSheet";
import { WebhookRuleFormSheet } from "./WebhookRuleFormSheet";
import { webhookSettingsStyles as styles } from "./webhook-settings-styles";

function WebhookSettingsContent() {
  const tokens = useTokens();
  const controller = useWebhookSettingsController();
  const { rules, rulesQuery } = controller;
  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={mobile.hitSlop}
      style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={controller.goBack}
    >
      <ArrowLeft size={22} color={tokens.foreground} />
    </Pressable>
  );

  return (
    <DrawerScaffold
      title="Webhook Rules"
      contentWidth="readable"
      headerLeading={headerLeading}
      refreshing={rulesQuery.isRefetching}
      onRefresh={() => void rulesQuery.refetch()}
    >
      {rulesQuery.isLoading ? <NativeLoadingState label="Loading rules" /> : null}
      {rulesQuery.error ? (
        <NativeErrorState
          message={rulesQuery.error.message}
          onRetry={() => void rulesQuery.refetch()}
        />
      ) : null}

      {!rulesQuery.isLoading && !rulesQuery.error ? (
        <NativeSection title="Rules" caption={`${rules.length}`}>
          {rules.length === 0 ? <NativeRow title="No rules" /> : null}
          {rules.map((rule) => (
            <NativeRow
              key={rule.id}
              title={rule.name}
              subtitle={`${getWebhookEventTypeLabel(rule.eventType)} · ${getWebhookActionKindLabel(rule.actionKind)}`}
              meta={getWebhookRuleMeta(rule)}
              leading={<WebhookIcon size={18} color={tokens.mutedForeground} />}
              trailing={
                <Switch
                  accessibilityLabel={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
                  value={rule.enabled}
                  disabled={controller.togglePending}
                  trackColor={{ true: tokens.primary }}
                  onValueChange={() => controller.toggleEnabled(rule)}
                />
              }
              onPress={() => controller.openManage(rule)}
            />
          ))}
          <NativeRow
            title="Add rule"
            leading={<Plus size={18} color={tokens.mutedForeground} />}
            onPress={controller.openCreateForm}
            last
          />
        </NativeSection>
      ) : null}

      <WebhookManageSheet
        rule={controller.manageRule}
        deliveries={controller.deliveries}
        deliveriesLoading={controller.deliveriesQuery.isLoading}
        deliveriesError={!!controller.deliveriesQuery.error}
        testMessage={controller.testFireMessage}
        testPending={controller.testFirePending}
        onClose={controller.closeManage}
        onTest={controller.testFire}
        onEdit={controller.openEditForm}
        onDelete={controller.requestDelete}
      />

      <WebhookDeleteSheet
        rule={controller.confirmDeleteRule}
        pending={controller.deletePending}
        error={controller.deleteError}
        onClose={controller.closeDelete}
        onConfirm={controller.confirmDelete}
        onResetError={controller.resetDeleteError}
      />

      <WebhookRuleFormSheet
        visible={controller.formOpen}
        form={controller.form}
        openPicker={controller.openPicker}
        baseOptions={controller.baseOptions}
        saving={controller.saving}
        error={controller.formError}
        onClose={controller.closeForm}
        onSave={controller.saveForm}
        onResetError={controller.resetFormError}
        onUpdate={controller.updateForm}
        onTogglePicker={controller.togglePicker}
        onSelectPicker={controller.selectPickerValue}
      />
    </DrawerScaffold>
  );
}

export default function WebhookSettingsScreen() {
  return (
    <ConnectionGuard>
      <WebhookSettingsContent />
    </ConnectionGuard>
  );
}
