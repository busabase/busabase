import type { LocalePreference } from "~/i18n";
import type { NotificationSettings } from "~/notifications/notification-settings";
import type { SettingsCloudAccount, SettingsLanguageOption } from "../types/settings";

export const AGENT_SKILL_URL = "https://busabase.com/SETUP_SKILL.md";
export const PRIVACY_URL = "https://busabase.com/privacy-policy";
export const SUPPORT_URL = "https://busabase.com/support";
export const TERMS_URL = "https://busabase.com/terms-of-service";

export const notificationIntervalOptions: Array<{
  label: string;
  value: NotificationSettings["pollIntervalSec"];
}> = [
  { label: "30s", value: 30 },
  { label: "60s", value: 60 },
  { label: "2m", value: 120 },
];

export const buildLanguageOptions = (
  automaticLabel: string,
  options: ReadonlyArray<{ code: string; label: string }>,
): SettingsLanguageOption[] => [
  { value: "auto", label: automaticLabel },
  ...options.map((option) => ({
    value: option.code as LocalePreference,
    label: option.label,
  })),
];

export const sortCloudAccounts = <Account extends SettingsCloudAccount>(accounts: Account[]) =>
  [...accounts].sort((left, right) => Number(right.isActive) - Number(left.isActive));
