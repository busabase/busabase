"use client";

import {
  type WebhookSettingsLabels as SharedWebhookSettingsLabels,
  WebhookSettingsPanel,
} from "busabase-core/domains/webhook/components";
import type { TranslationFunctions } from "~/i18n/i18n-types";

export type WebhookSettingsLabels = TranslationFunctions["webhookSettings"];

interface Props {
  labels: WebhookSettingsLabels;
  /** Whether this tab is the active one. */
  active: boolean;
}

// The app's generated i18n labels satisfy the shared panel's structural
// label shape (`SharedWebhookSettingsLabels`) — every field it reads is
// present here with a matching signature.
const toSharedLabels = (labels: WebhookSettingsLabels): SharedWebhookSettingsLabels => labels;

export function WebhookSettingsTab({ labels, active }: Props) {
  return (
    <div className="min-h-0 overflow-y-auto pr-1">
      <WebhookSettingsPanel labels={toSharedLabels(labels)} active={active} />
    </div>
  );
}
