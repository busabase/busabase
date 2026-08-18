import type { WebhookActionKind, WebhookEventType } from "busabase-contract/domains/webhook/types";
import { Save } from "lucide-react-native";
import { ScrollView, Switch, Text, View } from "react-native";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeChipList,
  NativeInlineError,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { WebhookBaseOption, WebhookFormPicker, WebhookFormState } from "../types/webhook-form";
import { ACTION_KIND_OPTIONS, EVENT_TYPE_OPTIONS } from "../utils/webhook-form";
import { WebhookSelectField } from "./WebhookSelectField";
import { webhookSettingsStyles as styles } from "./webhook-settings-styles";

interface Props {
  visible: boolean;
  form: WebhookFormState;
  openPicker: WebhookFormPicker;
  baseOptions: WebhookBaseOption[];
  saving: boolean;
  error: Error | null;
  onClose: () => void;
  onSave: () => void;
  onResetError: () => void;
  onUpdate: <Key extends keyof WebhookFormState>(key: Key, value: WebhookFormState[Key]) => void;
  onTogglePicker: (picker: Exclude<WebhookFormPicker, null>) => void;
  onSelectPicker: <Key extends "eventType" | "baseId">(
    key: Key,
    value: WebhookFormState[Key],
  ) => void;
}

export function WebhookRuleFormSheet({
  visible,
  form,
  openPicker,
  baseOptions,
  saving,
  error,
  onClose,
  onSave,
  onResetError,
  onUpdate,
  onTogglePicker,
  onSelectPicker,
}: Props) {
  const tokens = useTokens();

  return (
    <NativeBottomSheet
      visible={visible}
      title={form.id ? "Edit rule" : "New rule"}
      maxHeight="90%"
      showCloseButton
      onClose={onClose}
      footer={
        <NativeActionBar>
          {error ? <NativeInlineError message={error.message} onReset={onResetError} /> : null}
          <Button
            label={saving ? "Saving..." : form.id ? "Save changes" : "Create rule"}
            loading={saving}
            disabled={saving || !form.name.trim()}
            fullWidth
            leadingIcon={<Save size={18} color={tokens.primaryForeground} />}
            onPress={onSave}
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
          onChangeText={(value) => onUpdate("name", value)}
        />

        <WebhookSelectField<WebhookEventType>
          label="Event"
          value={form.eventType}
          options={EVENT_TYPE_OPTIONS}
          expanded={openPicker === "event"}
          onToggle={() => onTogglePicker("event")}
          onChange={(eventType) => onSelectPicker("eventType", eventType)}
        />

        <WebhookSelectField
          label="Applies to"
          value={form.baseId}
          options={baseOptions}
          expanded={openPicker === "base"}
          onToggle={() => onTogglePicker("base")}
          onChange={(baseId) => onSelectPicker("baseId", baseId)}
        />

        <Text style={[typography.small, { color: tokens.mutedForeground }]}>Action</Text>
        <View style={styles.fullBleedChips}>
          <NativeChipList<WebhookActionKind>
            value={form.actionKind}
            options={ACTION_KIND_OPTIONS}
            onChange={(actionKind) => onUpdate("actionKind", actionKind)}
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
              onChangeText={(value) => onUpdate("code", value)}
            />
            <TextInput
              label="Timeout (ms)"
              keyboardType="numeric"
              value={String(form.timeoutMs)}
              onChangeText={(value) => onUpdate("timeoutMs", Number(value) || 0)}
            />
          </>
        ) : (
          <>
            <TextInput
              label="Target URL"
              placeholder="https://example.com/webhook"
              keyboardType="url"
              value={form.targetUrl}
              onChangeText={(value) => onUpdate("targetUrl", value)}
            />
            <TextInput
              label={
                form.hasSecret ? "Secret (configured — leave blank to keep)" : "Secret (optional)"
              }
              placeholder="Signing secret"
              secureTextEntry
              value={form.secret}
              onChangeText={(value) => onUpdate("secret", value)}
            />
          </>
        )}

        <View style={styles.switchRow}>
          <Text style={[typography.small, { color: tokens.foreground }]}>Enabled</Text>
          <Switch
            accessibilityLabel="Rule enabled"
            value={form.enabled}
            trackColor={{ true: tokens.primary }}
            onValueChange={(value) => onUpdate("enabled", value)}
          />
        </View>
      </ScrollView>
    </NativeBottomSheet>
  );
}
