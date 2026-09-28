import type {
  BusabaseSourceChannel,
  SourceAttributionVO,
  UserRefVO,
} from "busabase-contract/types";
import { fmt } from "../../../i18n/fmt";
import type { CoreI18nMessages } from "../../../i18n/messages";
import { formatUserRefLabel, shortIdentifier } from "./format";

const channelLabels = (messages?: CoreI18nMessages): Record<BusabaseSourceChannel, string> => ({
  automation: messages?.activity.channelAutomation ?? "Automation",
  browser: messages?.activity.channelBrowser ?? "Browser",
  cli: messages?.activity.channelCli ?? "CLI",
  import: messages?.activity.channelImport ?? "Import",
  mcp: messages?.activity.channelMcp ?? "MCP",
  openapi: messages?.activity.channelOpenApi ?? "API",
  sdk: messages?.activity.channelSdk ?? "SDK",
  skill: messages?.activity.channelSkill ?? "Skill",
  web_ui: messages?.activity.channelWebUi ?? "Web UI",
  webhook: messages?.activity.channelWebhook ?? "Webhook",
});

const sameLabel = (left: string | null, right: string | null) =>
  Boolean(left && right && left.toLocaleLowerCase() === right.toLocaleLowerCase());

const legacyLabel = (fallbackId: string | null | undefined) => {
  const value = fallbackId?.trim();
  if (!value) return "—";
  return value.length <= 32 ? value : shortIdentifier(value);
};

export interface SubmissionIdentity {
  ownerLabel: string;
  credentialLabel: string | null;
  sourceLabel: string | null;
  channelLabel: string | null;
  inboxLabel: string;
  activityByline: string | null;
  identityUnavailable: boolean;
}

export const resolveSubmissionIdentity = (
  user: UserRefVO | null | undefined,
  fallbackId: string | null | undefined,
  attribution: SourceAttributionVO | null | undefined,
  messages?: CoreI18nMessages,
): SubmissionIdentity => {
  // An attribution can carry only a playbook (self-hosted writes with no
  // credential/channel): null or blank names fall through to the user, exactly
  // as if there were no attribution at all.
  const ownerLabel =
    attribution?.ownerName?.trim() ||
    (user ? formatUserRefLabel(user, fallbackId, messages) : legacyLabel(fallbackId));
  const channelLabel = attribution?.channel ? channelLabels(messages)[attribution.channel] : null;
  const credentialLabel = attribution?.displayName?.trim() || null;
  const hasIdentity = Boolean(
    attribution?.ownerName?.trim() || credentialLabel || attribution?.channel,
  );
  const sourceLabel = credentialLabel ?? channelLabel;
  const viaSource = sourceLabel
    ? fmt(messages?.activity.viaChannel ?? "via {channel}", { channel: sourceLabel })
    : null;
  const distinctChannel =
    channelLabel && !sameLabel(sourceLabel, channelLabel) ? channelLabel : null;

  return {
    ownerLabel,
    credentialLabel,
    sourceLabel,
    channelLabel,
    inboxLabel: viaSource ? `${ownerLabel} ${viaSource}` : ownerLabel,
    activityByline: [viaSource, distinctChannel].filter(Boolean).join(" · ") || null,
    identityUnavailable: !user && !hasIdentity && Boolean(fallbackId?.trim()),
  };
};
