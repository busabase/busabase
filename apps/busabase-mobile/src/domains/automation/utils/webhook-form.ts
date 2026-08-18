import type {
  WebhookActionKind,
  WebhookDeliveryStatus,
  WebhookEventType,
  WebhookHttpConfig,
  WebhookRuleInput,
  WebhookRuleUpdateInput,
  WebhookRuleVO,
} from "busabase-contract/domains/webhook/types";
import { formatListTime } from "~/lib/format";
import type { WebhookFormState } from "../types/webhook-form";

export const ALL_BASES_VALUE = "__all__";

export const EVENT_TYPE_OPTIONS: { value: WebhookEventType; label: string }[] = [
  { value: "record.created", label: "Record created" },
  { value: "ai_mention", label: "AI mention" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "asset.uploaded", label: "Asset uploaded" },
];

export const ACTION_KIND_OPTIONS: { value: WebhookActionKind; label: string }[] = [
  { value: "webhook", label: "Webhook" },
  { value: "notify_agent", label: "Notify agent" },
  { value: "run_function", label: "Run function" },
];

export const emptyWebhookForm = (): WebhookFormState => ({
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

export const webhookRuleToForm = (rule: WebhookRuleVO): WebhookFormState => ({
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
  ...(form.secret.trim() ? { secret: form.secret.trim() } : {}),
});

export const buildWebhookCreateInput = (form: WebhookFormState): WebhookRuleInput => {
  const common = {
    name: form.name.trim(),
    eventType: form.eventType,
    baseId: form.baseId === ALL_BASES_VALUE ? null : form.baseId,
    enabled: form.enabled,
  };
  if (form.actionKind === "run_function") {
    return {
      ...common,
      actionKind: "run_function",
      config: { code: form.code, timeoutMs: form.timeoutMs },
    };
  }
  return { ...common, actionKind: form.actionKind, config: buildHttpConfig(form) };
};

export const buildWebhookUpdateInput = (
  form: WebhookFormState,
  id: string,
): WebhookRuleUpdateInput => ({ ...buildWebhookCreateInput(form), id });

export const getWebhookEventTypeLabel = (eventType: WebhookEventType): string =>
  EVENT_TYPE_OPTIONS.find((option) => option.value === eventType)?.label ?? eventType;

export const getWebhookActionKindLabel = (actionKind: WebhookActionKind): string =>
  ACTION_KIND_OPTIONS.find((option) => option.value === actionKind)?.label ?? actionKind;

export const getWebhookDeliveryStatusLabel = (status: WebhookDeliveryStatus | null): string => {
  if (status === "success") return "Success";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  return "Never run";
};

export const getWebhookRuleMeta = (rule: WebhookRuleVO): string =>
  rule.lastTriggeredAt
    ? `${getWebhookDeliveryStatusLabel(rule.lastStatus)} · ${formatListTime(rule.lastTriggeredAt)}`
    : "Never run";
