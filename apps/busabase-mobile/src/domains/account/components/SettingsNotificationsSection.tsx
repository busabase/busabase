import { Bell } from "lucide-react-native";
import { StyleSheet, Switch, View } from "react-native";
import { NativeChipList, NativeRow, NativeSection } from "~/components/native-screen";
import type { CoreMessages } from "~/i18n/messages";
import type { NotificationSettings } from "~/notifications/notification-settings";
import { useTokens } from "~/theme/use-tokens";
import { notificationIntervalOptions } from "../utils/settings";

interface SettingsNotificationsSectionProps {
  t: CoreMessages;
  featureEnabled: boolean;
  supported: boolean;
  permissionDenied: boolean;
  settings: NotificationSettings;
  onEnabledChange: (enabled: boolean) => void;
  onPollIntervalChange: (interval: NotificationSettings["pollIntervalSec"]) => void;
  onOpenSystemSettings: () => void;
}

export function SettingsNotificationsSection({
  t,
  featureEnabled,
  supported,
  permissionDenied,
  settings,
  onEnabledChange,
  onPollIntervalChange,
  onOpenSystemSettings,
}: SettingsNotificationsSectionProps) {
  const tokens = useTokens();
  if (!supported && !permissionDenied && !settings.enabled) {
    return null;
  }

  return (
    <NativeSection title={t.settings.notifications}>
      <NativeRow
        title={t.settings.newChangeRequests}
        subtitle={!featureEnabled ? t.settings.disabledReviewBuild : undefined}
        leading={<Bell size={18} color={tokens.mutedForeground} />}
        trailing={
          <Switch
            accessibilityLabel={t.settings.notifyAccessibility}
            value={featureEnabled && supported && settings.enabled}
            disabled={!supported || !featureEnabled}
            trackColor={{ true: tokens.primary }}
            onValueChange={onEnabledChange}
          />
        }
        last={!permissionDenied && !settings.enabled}
      />
      {permissionDenied ? (
        <NativeRow
          title={t.settings.openSystemSettings}
          subtitle={t.settings.notificationsOff}
          destructive
          leading={<Bell size={18} color={tokens.destructive} />}
          onPress={onOpenSystemSettings}
          last={!settings.enabled}
        />
      ) : null}
      {settings.enabled ? (
        <NativeRow title={t.settings.checkEvery} last>
          <View style={styles.fullBleedChips}>
            <NativeChipList
              value={String(settings.pollIntervalSec)}
              options={notificationIntervalOptions.map((option) => ({
                value: String(option.value),
                label: option.label,
              }))}
              onChange={(value) =>
                onPollIntervalChange(Number(value) as NotificationSettings["pollIntervalSec"])
              }
            />
          </View>
        </NativeRow>
      ) : null}
    </NativeSection>
  );
}

const styles = StyleSheet.create({
  fullBleedChips: { marginHorizontal: -14, paddingTop: 8 },
});
