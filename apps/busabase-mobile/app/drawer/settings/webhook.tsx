import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BaseVO } from "busabase-contract/domains/base/types";
import type {
  WebhookActionKind,
  WebhookDeliveryStatus,
  WebhookEventType,
  WebhookHttpConfig,
  WebhookRuleInput,
  WebhookRuleUpdateInput,
  WebhookRuleVO,
} from "busabase-contract/domains/webhook/types";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  Pencil,
  Plus,
  Save,
  Trash2,
  Webhook as WebhookIcon,
  Zap,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import {
  NativeActionBar,
  NativeActionItem,
  NativeActionRow,
  NativeBottomSheet,
  NativeChipList,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
  NativeRow,
  NativeScreen,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { useI18n } from "~/i18n";
import { formatListTime } from "~/lib/format";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

// Sentinel for the "All bases" chip — the wire representation of "space-wide"
// is `baseId: null`, and chip values can't be null.
const ALL_BASES_VALUE = "__all__";

interface WebhookFormState {
  id: string | null;
  name: string;
  eventType: WebhookEventType;
  baseId: string;
  actionKind: WebhookActionKind;
  targetUrl: string;
  secret: string;
  hasSecret: boolean;
  code: string;
  timeoutMs: number;
  enabled: boolean;
}

const emptyForm = (): WebhookFormState => ({
  id: null,
  name: "",
  eventType: "record.created",
  baseId: ALL_BASES_VALUE,
  actionKind: "webhook",
  targetUrl: "",
  secret: "",
  hasSecret: false,
  code: "",
  timeoutMs: 2000,
  enabled: true,
});

const ruleToForm = (rule: WebhookRuleVO): WebhookFormState => ({
  id: rule.id,
  name: rule.name,
  eventType: rule.eventType,
  baseId: rule.baseId ?? ALL_BASES_VALUE,
  actionKind: rule.actionKind,
  targetUrl: rule.actionKind === "run_function" ? "" : rule.config.targetUrl,
  secret: "",
  hasSecret: rule.actionKind === "run_function" ? false : rule.config.hasSecret,
  code: rule.actionKind === "run_function" ? rule.config.code : "",
  timeoutMs: rule.actionKind === "run_function" ? rule.config.timeoutMs : 2000,
  enabled: rule.enabled,
});

const buildHttpConfig = (form: WebhookFormState): WebhookHttpConfig => ({
  targetUrl: form.targetUrl.trim(),
  // Blank secret means "leave the currently stored (encrypted) secret unchanged".
  ...(form.secret.trim() ? { secret: form.secret.trim() } : {}),
});

function buildCreateInput(form: WebhookFormState): WebhookRuleInput {
  const common = {
    name: form.name.trim(),
    eventType: form.eventType,
    baseId: form.baseId === ALL_BASES_VALUE ? null : form.baseId,
    enabled: form.enabled,
  };
  switch (form.actionKind) {
    case "run_function":
      return {
        ...common,
        actionKind: "run_function",
        config: { code: form.code, timeoutMs: form.timeoutMs },
      };
    case "webhook":
      return { ...common, actionKind: "webhook", config: buildHttpConfig(form) };
    case "notify_agent":
      return { ...common, actionKind: "notify_agent", config: buildHttpConfig(form) };
  }
}

function buildUpdateInput(form: WebhookFormState, id: string): WebhookRuleUpdateInput {
  const common = {
    id,
    name: form.name.trim(),
    eventType: form.eventType,
    baseId: form.baseId === ALL_BASES_VALUE ? null : form.baseId,
    enabled: form.enabled,
  };
  switch (form.actionKind) {
    case "run_function":
      return {
        ...common,
        actionKind: "run_function",
        config: { code: form.code, timeoutMs: form.timeoutMs },
      };
    case "webhook":
      return { ...common, actionKind: "webhook", config: buildHttpConfig(form) };
    case "notify_agent":
      return { ...common, actionKind: "notify_agent", config: buildHttpConfig(form) };
  }
}

const EVENT_TYPE_OPTIONS: Array<{ value: WebhookEventType; label: string }> = [
  { value: "record.created", label: "Record created" },
  { value: "ai_mention", label: "AI mention" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "asset.uploaded", label: "Asset uploaded" },
];

const ACTION_KIND_OPTIONS: Array<{ value: WebhookActionKind; label: string }> = [
  { value: "webhook", label: "Webhook" },
  { value: "notify_agent", label: "Notify agent" },
  { value: "run_function", label: "Run function" },
];

function eventTypeLabel(eventType: WebhookEventType): string {
  return EVENT_TYPE_OPTIONS.find((option) => option.value === eventType)?.label ?? eventType;
}

function actionKindLabel(actionKind: WebhookActionKind): string {
  return ACTION_KIND_OPTIONS.find((option) => option.value === actionKind)?.label ?? actionKind;
}

function statusLabel(status: WebhookDeliveryStatus | null): string {
  if (status === "success") return "Success";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  return "Never run";
}

function ruleMeta(rule: WebhookRuleVO): string {
  if (!rule.lastTriggeredAt) {
    return "Never run";
  }
  return `${statusLabel(rule.lastStatus)} · ${formatListTime(rule.lastTriggeredAt)}`;
}

function WebhookSettingsContent() {
  const router = useRouter();
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<WebhookFormState>(emptyForm());
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
      ? buda.orpc.bases.list.queryOptions({})
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
    setFormOpen(false);
    setForm(emptyForm());
  };

  const openCreateForm = () => {
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEditForm = (rule: WebhookRuleVO) => {
    setForm(ruleToForm(rule));
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
    const nextForm = { ...ruleToForm(rule), enabled: !rule.enabled };
    toggleMutation.mutate(buildUpdateInput(nextForm, rule.id));
  };

  const saving = createMutation.isPending || updateMutation.isPending;
  const formError = createMutation.error ?? updateMutation.error;

  const saveForm = () => {
    if (form.id) {
      updateMutation.mutate(buildUpdateInput(form, form.id));
    } else {
      createMutation.mutate(buildCreateInput(form));
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
    <NativeScreen
      title="Webhook Rules"
      subtitle="Automation triggered by events"
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
        <NativeSection title="Automation rules" caption={`${rules.length}`}>
          {rules.length === 0 ? (
            <NativeRow
              title="No rules yet"
              subtitle="Create a rule to react to record, AI, or asset events."
            />
          ) : null}
          {rules.map((rule) => (
            <NativeRow
              key={rule.id}
              title={rule.name}
              subtitle={`${eventTypeLabel(rule.eventType)} · ${actionKindLabel(rule.actionKind)}`}
              meta={ruleMeta(rule)}
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

      <NativeBottomSheet
        visible={!!manageRule}
        title={manageRule?.name}
        description={
          manageRule
            ? `${eventTypeLabel(manageRule.eventType)} · ${actionKindLabel(manageRule.actionKind)}`
            : undefined
        }
        showCloseButton
        onClose={closeManage}
        footer={
          manageRule ? (
            <NativeActionBar>
              {testFireMessage ? (
                <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                  {testFireMessage}
                </Text>
              ) : null}
              <NativeActionRow>
                <NativeActionItem>
                  <Button
                    label="Test fire"
                    variant="secondary"
                    loading={testFireMutation.isPending}
                    leadingIcon={<Zap size={18} color={tokens.foreground} />}
                    onPress={() => testFireMutation.mutate(manageRule.id)}
                  />
                </NativeActionItem>
                <NativeActionItem>
                  <Button
                    label={t.common.edit}
                    variant="secondary"
                    leadingIcon={<Pencil size={18} color={tokens.foreground} />}
                    onPress={() => openEditForm(manageRule)}
                  />
                </NativeActionItem>
              </NativeActionRow>
              <Button
                label="Delete rule"
                variant="destructive"
                leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
                onPress={() => setConfirmDeleteRuleId(manageRule.id)}
              />
              <Button label={t.common.close} variant="ghost" onPress={closeManage} />
            </NativeActionBar>
          ) : undefined
        }
      >
        {manageRule ? (
          <View style={styles.manageBody}>
            <Text
              style={[typography.caption, styles.sectionLabel, { color: tokens.mutedForeground }]}
            >
              Recent deliveries
            </Text>
            {deliveriesQuery.isLoading ? <NativeLoadingState label="Loading" /> : null}
            {deliveriesQuery.error ? (
              <Text style={[typography.small, { color: tokens.destructive }]}>
                Could not load delivery history.
              </Text>
            ) : null}
            {!deliveriesQuery.isLoading && !deliveriesQuery.error && deliveries.length === 0 ? (
              <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                No deliveries yet.
              </Text>
            ) : null}
            {deliveries.map((delivery) => (
              <View key={delivery.id} style={[styles.deliveryRow, { borderColor: tokens.border }]}>
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
                  {statusLabel(delivery.status)}
                </Text>
                {delivery.httpStatus !== null ? (
                  <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                    {delivery.httpStatus}
                  </Text>
                ) : null}
                <Text
                  style={[
                    typography.caption,
                    styles.deliveryTime,
                    { color: tokens.mutedForeground },
                  ]}
                >
                  {formatListTime(delivery.createdAt)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </NativeBottomSheet>

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
            <Button
              label={t.common.cancel}
              variant="ghost"
              disabled={saving}
              fullWidth
              onPress={closeForm}
            />
          </NativeActionBar>
        }
      >
        <View style={styles.formBody}>
          <TextInput
            label="Name"
            placeholder="Notify on new records"
            value={form.name}
            onChangeText={(value) => setForm((current) => ({ ...current, name: value }))}
          />

          <Text style={[typography.small, { color: tokens.mutedForeground }]}>Event</Text>
          <View style={styles.fullBleedChips}>
            <NativeChipList<WebhookEventType>
              value={form.eventType}
              options={EVENT_TYPE_OPTIONS}
              onChange={(eventType) => setForm((current) => ({ ...current, eventType }))}
            />
          </View>

          <Text style={[typography.small, { color: tokens.mutedForeground }]}>Applies to</Text>
          <View style={styles.fullBleedChips}>
            <NativeChipList<string>
              value={form.baseId}
              options={[
                { value: ALL_BASES_VALUE, label: "All bases" },
                ...bases.map((base) => ({ value: base.id, label: base.name })),
              ]}
              onChange={(baseId) => setForm((current) => ({ ...current, baseId }))}
            />
          </View>

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
        </View>
      </NativeBottomSheet>
    </NativeScreen>
  );
}

export default function WebhookSettingsScreen() {
  return (
    <ConnectionGuard>
      <WebhookSettingsContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  fullBleedChips: { marginHorizontal: -20 },
  formBody: { gap: 12 },
  manageBody: { gap: 8 },
  sectionLabel: { textTransform: "uppercase" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  deliveryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  deliveryTime: { marginLeft: "auto" },
  codeInput: {
    minHeight: 140,
    paddingTop: 12,
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 19,
  },
});
