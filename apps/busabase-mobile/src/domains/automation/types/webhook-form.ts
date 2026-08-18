import type { WebhookActionKind, WebhookEventType } from "busabase-contract/domains/webhook/types";

export interface WebhookFormState {
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

export type WebhookFormPicker = "event" | "base" | null;
