import type { LocalePreference } from "~/i18n";

export interface SettingsLanguageOption {
  value: LocalePreference;
  label: string;
}

export interface SettingsCloudAccount {
  id: string;
  isActive: boolean;
  user?: {
    email: string;
    name: string;
  };
}
