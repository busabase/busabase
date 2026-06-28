import AsyncStorage from "@react-native-async-storage/async-storage";

const SETTINGS_KEY = "busabase-mobile.notification-settings.v1";

export interface NotificationSettings {
  enabled: boolean;
  /** Foreground polling interval in seconds. */
  pollIntervalSec: 30 | 60 | 120;
}

export const defaultNotificationSettings: NotificationSettings = {
  enabled: false,
  pollIntervalSec: 60,
};

export async function loadNotificationSettings(): Promise<NotificationSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return defaultNotificationSettings;
    }
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    return {
      enabled: parsed.enabled === true,
      pollIntervalSec:
        parsed.pollIntervalSec === 30 || parsed.pollIntervalSec === 120
          ? parsed.pollIntervalSec
          : 60,
    };
  } catch {
    return defaultNotificationSettings;
  }
}

export async function saveNotificationSettings(settings: NotificationSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
