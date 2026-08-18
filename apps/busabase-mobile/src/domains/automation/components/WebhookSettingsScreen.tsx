import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BaseVO } from "busabase-contract/domains/base/types";
import type {
  WebhookActionKind,
  WebhookRuleInput,
  WebhookRuleUpdateInput,
  WebhookRuleVO,
} from "busabase-contract/domains/webhook/types";
import { useRouter } from "expo-router";
import { ArrowLeft, Plus, Save, Trash2, Webhook as WebhookIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeChipList,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { useI18n } from "~/i18n";
import { mobile, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { WebhookFormPicker, WebhookFormState } from "../types/webhook-form";
import {
  ACTION_KIND_OPTIONS,
  ALL_BASES_VALUE,
  buildWebhookCreateInput,
  buildWebhookUpdateInput,
  EVENT_TYPE_OPTIONS,
  emptyWebhookForm,
  getWebhookActionKindLabel,
  getWebhookEventTypeLabel,
  getWebhookRuleMeta,
  webhookRuleToForm,
} from "../utils/webhook-form";
import { WebhookManageSheet } from "./WebhookManageSheet";
import { WebhookSelectField } from "./WebhookSelectField";
import { webhookSettingsStyles as styles } from "./webhook-settings-styles";

function WebhookSettingsContent() {
  const router = useRouter();
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<WebhookFormState>(emptyWebhookForm());
  const [openPicker, setOpenPicker] = useState<WebhookFormPicker>(null);
  const [manageRuleId, setManageRuleId] = useState<string | null>(null);
  const [confirmDeleteRuleId, setConfirmDeleteRuleId] = useState<string | null>(null);
  const [testFireMessage, setTestFireMessage] = useState<string | null>(null);

  const rulesQuery = useQuery(
    buda
      ? buda.orpc.webhooks.list.queryOptions()
      : { queryKey: ["no-connection", "webhooks"], queryFn: skipToken },
  );
  const basesQuery = useQuery(
    buda
      ? buda.orpc.bases.list.queryOptions({ input: {} })
      : { queryKey: ["no-connection", "webhooks-bases"], queryFn: skipToken },
  );
  const rules = rulesQuery.data ?? [];
  const bases: BaseVO[] = basesQuery.data ?? [];
  const manageRule = manageRuleId ? (rules.find((rule) => rule.id === manageRuleId) ?? null) : null;

  const deliveriesQuery = useQuery(
    buda && manageRuleId
      ? buda.orpc.webhooks.deliveries.queryOptions({ input: { ruleId: manageRuleId, limit: 5 } })
      : { queryKey: ["no-connection", "webhook-deliveries"], queryFn: skipToken },
  );

  const invalidateRules = () =>
    void queryClient.invalidateQueries({ queryKey: buda?.orpc.webhooks.list.key() });

  const closeForm = () => {
    setOpenPicker(null);
    setFormOpen(false);
    setForm(emptyWebhookForm());
  };

  const openCreateForm = () => {
    setOpenPicker(null);
    setForm(emptyWebhookForm());
    setFormOpen(true);
  };

  const openEditForm = (rule: WebhookRuleVO) => {
    setOpenPicker(null);
    setForm(webhookRuleToForm(rule));
    setManageRuleId(null);
    setFormOpen(true);
  };

  const openManage = (rule: WebhookRuleVO) => {
    setTestFireMessage(null);
    setManageRuleId(rule.id);
  };

  const closeManage = () => {
    setManageRuleId(null);
    setTestFireMessage(null);
  };

  const createMutation = useMutation({
    mutationFn: async (input: WebhookRuleInput) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.webhooks.create(input);
    },
    onSuccess: () => {
      invalidateRules();
      closeForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (input: WebhookRuleUpdateInput) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.webhooks.update(input);
    },
    onSuccess: () => {
      invalidateRules();
      closeForm();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (input: WebhookRuleUpdateInput) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.webhooks.update(input);
    },
    onSuccess: () => invalidateRules(),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.webhooks.delete({ id });
    },
    onSuccess: () => {
      invalidateRules();
      setConfirmDeleteRuleId(null);
      setManageRuleId(null);
    },
  });

  const testFireMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.webhooks.testFire({ id });
    },
    onSuccess: (delivery, id) => {
      invalidateRules();
      void queryClient.invalidateQueries({
        queryKey: buda?.orpc.webhooks.deliveries.key({ input: { ruleId: id, limit: 5 } }),
      });
      setTestFireMessage(
        delivery.status === "success"
          ? "Test delivery succeeded."
          : delivery.status === "failed"
            ? `Test delivery failed${delivery.detail ? `: ${delivery.detail}` : ""}.`
            : "Test delivery skipped.",
      );
    },
    onError: () => setTestFireMessage("Could not fire the test request."),
  });

  const toggleEnabled = (rule: WebhookRuleVO) => {
    const nextForm = { ...webhookRuleToForm(rule), enabled: !rule.enabled };
    toggleMutation.mutate(buildWebhookUpdateInput(nextForm, rule.id));
  };

  const saving = createMutation.isPending || updateMutation.isPending;
  const formError = createMutation.error ?? updateMutation.error;
  const baseOptions = [
    { value: ALL_BASES_VALUE, label: "All bases" },
    ...bases.map((base) => ({ value: base.id, label: base.name })),
  ];

  const saveForm = () => {
    if (form.id) {
      updateMutation.mutate(buildWebhookUpdateInput(form, form.id));
    } else {
      createMutation.mutate(buildWebhookCreateInput(form));
    }
  };

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/drawer/settings"));

  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={mobile.hitSlop}
      style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={goBack}
    >
      <ArrowLeft size={22} color={tokens.foreground} />
    </Pressable>
  );

  const deliveries = deliveriesQuery.data ?? [];
  const confirmDeleteRule = confirmDeleteRuleId
    ? (rules.find((rule) => rule.id === confirmDeleteRuleId) ?? null)
    : null;

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
                  disabled={toggleMutation.isPending}
                  trackColor={{ true: tokens.primary }}
                  onValueChange={() => toggleEnabled(rule)}
                />
              }
              onPress={() => openManage(rule)}
            />
          ))}
          <NativeRow
            title="Add rule"
            leading={<Plus size={18} color={tokens.mutedForeground} />}
            onPress={openCreateForm}
            last
          />
        </NativeSection>
      ) : null}

      <WebhookManageSheet
        rule={manageRule}
        deliveries={deliveries}
        deliveriesLoading={deliveriesQuery.isLoading}
        deliveriesError={!!deliveriesQuery.error}
        testMessage={testFireMessage}
        testPending={testFireMutation.isPending}
        onClose={closeManage}
        onTest={(id) => testFireMutation.mutate(id)}
        onEdit={openEditForm}
        onDelete={setConfirmDeleteRuleId}
      />

      <NativeBottomSheet
        visible={!!confirmDeleteRule}
        title="Delete rule?"
        description={
          confirmDeleteRule
            ? `This permanently removes "${confirmDeleteRule.name}". This cannot be undone.`
            : undefined
        }
        showCloseButton
        onClose={() => setConfirmDeleteRuleId(null)}
        footer={
          <NativeActionBar>
            {deleteMutation.error ? (
              <NativeInlineError
                message={deleteMutation.error.message}
                onReset={() => deleteMutation.reset()}
              />
            ) : null}
            <Button
              label="Delete rule"
              variant="destructive"
              loading={deleteMutation.isPending}
              fullWidth
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              onPress={() => confirmDeleteRule && deleteMutation.mutate(confirmDeleteRule.id)}
            />
            <Button
              label={t.common.cancel}
              variant="ghost"
              disabled={deleteMutation.isPending}
              fullWidth
              onPress={() => setConfirmDeleteRuleId(null)}
            />
          </NativeActionBar>
        }
      />

      <NativeBottomSheet
        visible={formOpen}
        title={form.id ? "Edit rule" : "New rule"}
        maxHeight="90%"
        showCloseButton
        onClose={closeForm}
        footer={
          <NativeActionBar>
            {formError ? (
              <NativeInlineError
                message={formError.message}
                onReset={() => {
                  createMutation.reset();
                  updateMutation.reset();
                }}
              />
            ) : null}
            <Button
              label={saving ? "Saving..." : form.id ? "Save changes" : "Create rule"}
              loading={saving}
              disabled={saving || !form.name.trim()}
              fullWidth
              leadingIcon={<Save size={18} color={tokens.primaryForeground} />}
              onPress={saveForm}
            />
          </NativeActionBar>
        }
      >
        <ScrollView
          style={styles.formScroll}
          contentContainerStyle={styles.formBody}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          <TextInput
            label="Name"
            placeholder="Notify on new records"
            value={form.name}
            onChangeText={(value) => setForm((current) => ({ ...current, name: value }))}
          />

          <WebhookSelectField
            label="Event"
            value={form.eventType}
            options={EVENT_TYPE_OPTIONS}
            expanded={openPicker === "event"}
            onToggle={() => setOpenPicker((current) => (current === "event" ? null : "event"))}
            onChange={(eventType) => {
              setForm((current) => ({ ...current, eventType }));
              setOpenPicker(null);
            }}
          />

          <WebhookSelectField
            label="Applies to"
            value={form.baseId}
            options={baseOptions}
            expanded={openPicker === "base"}
            onToggle={() => setOpenPicker((current) => (current === "base" ? null : "base"))}
            onChange={(baseId) => {
              setForm((current) => ({ ...current, baseId }));
              setOpenPicker(null);
            }}
          />

          <Text style={[typography.small, { color: tokens.mutedForeground }]}>Action</Text>
          <View style={styles.fullBleedChips}>
            <NativeChipList<WebhookActionKind>
              value={form.actionKind}
              options={ACTION_KIND_OPTIONS}
              onChange={(actionKind) => setForm((current) => ({ ...current, actionKind }))}
            />
          </View>

          {form.actionKind === "run_function" ? (
            <>
              <TextInput
                label="Function code"
                placeholder="module.exports = async (event) => {}"
                multiline
                textAlignVertical="top"
                style={styles.codeInput}
                value={form.code}
                onChangeText={(value) => setForm((current) => ({ ...current, code: value }))}
              />
              <TextInput
                label="Timeout (ms)"
                keyboardType="numeric"
                value={String(form.timeoutMs)}
                onChangeText={(value) =>
                  setForm((current) => ({ ...current, timeoutMs: Number(value) || 0 }))
                }
              />
            </>
          ) : (
            <>
              <TextInput
                label="Target URL"
                placeholder="https://example.com/webhook"
                keyboardType="url"
                value={form.targetUrl}
                onChangeText={(value) => setForm((current) => ({ ...current, targetUrl: value }))}
              />
              <TextInput
                label={
                  form.hasSecret ? "Secret (configured — leave blank to keep)" : "Secret (optional)"
                }
                placeholder="Signing secret"
                secureTextEntry
                value={form.secret}
                onChangeText={(value) => setForm((current) => ({ ...current, secret: value }))}
              />
            </>
          )}

          <View style={styles.switchRow}>
            <Text style={[typography.small, { color: tokens.foreground }]}>Enabled</Text>
            <Switch
              accessibilityLabel="Rule enabled"
              value={form.enabled}
              trackColor={{ true: tokens.primary }}
              onValueChange={(value) => setForm((current) => ({ ...current, enabled: value }))}
            />
          </View>
        </ScrollView>
      </NativeBottomSheet>
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
