import Constants from "expo-constants";
import { useRouter } from "expo-router";
import {
  Bell,
  ExternalLink,
  Languages,
  LogOut,
  Server,
  Shield,
  Sparkles,
  Trash2,
} from "lucide-react-native";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { Button } from "~/components/ui/Button";
import { useConnection } from "~/connection/connection-store";
import { type LocalePreference, useI18n } from "~/i18n";
import { formatDate } from "~/lib/format";
import { useNotifications } from "~/notifications/notification-provider";
import type { NotificationSettings } from "~/notifications/notification-settings";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const intervalOptions: Array<{ label: string; value: NotificationSettings["pollIntervalSec"] }> = [
  { label: "30s", value: 30 },
  { label: "60s", value: 60 },
  { label: "2m", value: 120 },
];

function SettingsContent() {
  const router = useRouter();
  const tokens = useTokens();
  const { t, preference, setPreference, options } = useI18n();
  const { state, disconnect, connectSelfHosted, removeServerFromHistory } = useConnection();
  const { supported, settings, permissionDenied, setEnabled, setPollInterval, openSystemSettings } =
    useNotifications();
  const [switchingServer, setSwitchingServer] = useState<string | null>(null);
  const connection = state.status === "connected" ? state.connection : null;
  const otherServers = state.serverHistory.filter((url) => url !== connection?.serverUrl);

  const handleDisconnect = async () => {
    await disconnect();
    router.replace("/");
  };

  const handleSwitch = async (serverUrl: string) => {
    setSwitchingServer(serverUrl);
    try {
      await connectSelfHosted(serverUrl);
      router.replace("/drawer/inbox");
    } finally {
      setSwitchingServer(null);
    }
  };

  return (
    <DrawerScaffold title="Settings" subtitle="Connection and notifications">
      <View style={styles.sections}>
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[typography.h2, { color: tokens.foreground }]}>Current connection</Text>
          <Text style={[typography.body, { color: tokens.mutedForeground }]}>
            {connection?.serverUrl ?? "No server connected"}
          </Text>
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            Connected {formatDate(connection?.connectedAt)}
          </Text>
        </View>

        {otherServers.length > 0 ? (
          <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <Text style={[typography.h2, { color: tokens.foreground }]}>Saved servers</Text>
            {otherServers.map((serverUrl) => (
              <View key={serverUrl} style={[styles.serverRow, { borderColor: tokens.border }]}>
                <Server size={18} color={tokens.mutedForeground} />
                <Text
                  numberOfLines={1}
                  style={[typography.body, styles.serverUrl, { color: tokens.foreground }]}
                >
                  {serverUrl}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to ${serverUrl}`}
                  style={[styles.serverAction, { backgroundColor: tokens.primaryMuted }]}
                  onPress={() => void handleSwitch(serverUrl)}
                >
                  <Text style={[typography.small, { color: tokens.primary }]}>
                    {switchingServer === serverUrl ? "..." : "Switch"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${serverUrl}`}
                  hitSlop={8}
                  onPress={() => void removeServerFromHistory(serverUrl)}
                >
                  <Trash2 size={18} color={tokens.destructive} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={styles.notificationTitle}>
            <Languages size={18} color={tokens.foreground} />
            <Text style={[typography.h2, { color: tokens.foreground }]}>{t.settings.language}</Text>
          </View>
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            {t.settings.languageHint}
          </Text>
          <View style={styles.languageRow}>
            {[
              { value: "auto" as LocalePreference, label: t.settings.auto },
              ...options.map((option) => ({
                value: option.code as LocalePreference,
                label: option.label,
              })),
            ].map((option) => {
              const active = preference === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.intervalChip,
                    {
                      backgroundColor: active ? tokens.primaryMuted : "transparent",
                      borderColor: active ? tokens.primary : tokens.border,
                    },
                  ]}
                  onPress={() => setPreference(option.value)}
                >
                  <Text
                    style={[
                      typography.small,
                      { color: active ? tokens.foreground : tokens.mutedForeground },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={styles.notificationHeader}>
            <View style={styles.notificationTitle}>
              <Bell size={18} color={tokens.foreground} />
              <Text style={[typography.h2, { color: tokens.foreground }]}>Notifications</Text>
            </View>
            <Switch
              accessibilityLabel="Notify about new change requests"
              value={supported && settings.enabled}
              disabled={!supported}
              trackColor={{ true: tokens.primary }}
              onValueChange={(value) => void setEnabled(value)}
            />
          </View>
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            {supported
              ? "Get a notification when a new change request arrives for review. The app polls the server while open; in the background the system checks roughly every 15 minutes."
              : "Notifications are only available in the iOS and Android app, not on web."}
          </Text>
          {permissionDenied ? (
            <View style={[styles.permissionNote, { borderColor: tokens.destructive }]}>
              <Text style={[typography.small, { color: tokens.destructive }]}>
                Notification permission is denied for this app.
              </Text>
              <Button
                label="Open system settings"
                variant="secondary"
                fullWidth
                onPress={openSystemSettings}
              />
            </View>
          ) : null}
          {settings.enabled ? (
            <View style={styles.intervalRow}>
              <Text style={[typography.small, { color: tokens.mutedForeground }]}>Check every</Text>
              {intervalOptions.map((option) => {
                const active = settings.pollIntervalSec === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    style={[
                      styles.intervalChip,
                      {
                        backgroundColor: active ? tokens.primaryMuted : "transparent",
                        borderColor: active ? tokens.primary : tokens.border,
                      },
                    ]}
                    onPress={() => void setPollInterval(option.value)}
                  >
                    <Text
                      style={[
                        typography.small,
                        { color: active ? tokens.foreground : tokens.mutedForeground },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>

        {connection ? (
          <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <View style={styles.notificationTitle}>
              <Sparkles size={18} color={tokens.foreground} />
              <Text style={[typography.h2, { color: tokens.foreground }]}>Agent Skill</Text>
            </View>
            <Text style={[typography.small, { color: tokens.mutedForeground }]}>
              Point an AI agent at this server's skill manifest so it can read bases and submit
              change requests on your behalf.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Agent Skill manifest"
              style={styles.linkRow}
              onPress={() => void Linking.openURL(`${connection.serverUrl}/SKILL.md`)}
            >
              <ExternalLink size={16} color={tokens.primary} />
              <Text
                numberOfLines={1}
                style={[typography.small, styles.serverUrl, { color: tokens.primary }]}
              >
                {connection.serverUrl}/SKILL.md
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={styles.notificationTitle}>
            <Shield size={18} color={tokens.foreground} />
            <Text style={[typography.h2, { color: tokens.foreground }]}>About</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={[typography.body, { color: tokens.foreground }]}>Busabase</Text>
            <Text style={[typography.small, { color: tokens.mutedForeground }]}>
              {`v${Constants.expoConfig?.version ?? "—"}`}
            </Text>
          </View>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Open Privacy Policy"
            style={styles.linkRow}
            onPress={() => void Linking.openURL("https://busabase.com/privacy-policy")}
          >
            <ExternalLink size={16} color={tokens.primary} />
            <Text style={[typography.small, { color: tokens.primary }]}>Privacy Policy</Text>
          </Pressable>
        </View>

        <View style={styles.actions}>
          <View style={styles.row}>
            <LogOut size={18} color={tokens.destructive} />
            <Text style={[typography.small, { color: tokens.mutedForeground }]}>
              Disconnecting clears the saved URL on this device. Saved servers stay available.
            </Text>
          </View>
          <Button label="Disconnect" variant="destructive" fullWidth onPress={handleDisconnect} />
        </View>
      </View>
    </DrawerScaffold>
  );
}

export default function SettingsScreen() {
  return (
    <ConnectionGuard>
      <SettingsContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  sections: { marginHorizontal: 20, gap: 14 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: 16,
    gap: 10,
  },
  serverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  serverUrl: { flex: 1, minWidth: 0 },
  serverAction: {
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  notificationHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  notificationTitle: { flexDirection: "row", alignItems: "center", gap: 8 },
  permissionNote: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
    gap: 10,
  },
  intervalRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  languageRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  intervalChip: {
    minHeight: 32,
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 12,
  },
  actions: { gap: 12 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  aboutRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
});
