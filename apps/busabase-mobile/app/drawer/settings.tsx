import Constants from "expo-constants";
import { useRouter } from "expo-router";
import {
  Bell,
  ChevronRight,
  ExternalLink,
  Languages,
  LogOut,
  Server,
  Shield,
  Sparkles,
  Trash2,
} from "lucide-react-native";
import { useState } from "react";
import { Linking, StyleSheet, Switch, View } from "react-native";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { SpaceSelector } from "~/components/busabase/SpaceSelector";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeChipList,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useConnection } from "~/connection/connection-store";
import { type LocalePreference, useI18n } from "~/i18n";
import { formatDate } from "~/lib/format";
import { useNotifications } from "~/notifications/notification-provider";
import type { NotificationSettings } from "~/notifications/notification-settings";
import { useTokens } from "~/theme/use-tokens";

const intervalOptions: Array<{ label: string; value: NotificationSettings["pollIntervalSec"] }> = [
  { label: "30s", value: 30 },
  { label: "60s", value: 60 },
  { label: "2m", value: 120 },
];

const AGENT_SKILL_URL = "https://busabase.com/SETUP_SKILL.md";
const SUPPORT_URL = "https://busabase.com/support";
const TERMS_URL = "https://busabase.com/terms-of-service";

const getDisplayVersion = () => {
  const version = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "—";
  const buildNumber =
    Constants.nativeBuildVersion ??
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode?.toString();
  return buildNumber ? `v${version}-${buildNumber}` : `v${version}`;
};

function SettingsContent() {
  const router = useRouter();
  const tokens = useTokens();
  const { t, preference, setPreference, options } = useI18n();
  const { state, disconnect, connectSelfHosted, removeServerFromHistory } = useConnection();
  const { supported, settings, permissionDenied, setEnabled, setPollInterval, openSystemSettings } =
    useNotifications();
  const [switchingServer, setSwitchingServer] = useState<string | null>(null);
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [disconnectSheetOpen, setDisconnectSheetOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const connection = state.status === "connected" ? state.connection : null;
  const otherServers = state.serverHistory.filter((url) => url !== connection?.serverUrl);
  const displayVersion = getDisplayVersion();

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnect();
      setDisconnectSheetOpen(false);
      router.replace("/");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSwitch = async (serverUrl: string) => {
    setSwitchingServer(serverUrl);
    try {
      await connectSelfHosted(serverUrl);
      setSelectedServer(null);
      router.replace("/drawer/inbox");
    } finally {
      setSwitchingServer(null);
    }
  };

  const handleRemoveSavedServer = async () => {
    if (!selectedServer) {
      return;
    }
    await removeServerFromHistory(selectedServer);
    setSelectedServer(null);
  };

  const connectionLabel = connection
    ? connection.mode === "cloud"
      ? "Busabase Cloud"
      : connection.mode === "demo"
        ? "Demo workspace"
        : "Self-hosted server"
    : "No server connected";
  const disconnectHint =
    connection?.mode === "cloud"
      ? "Signs this device out of Busabase Cloud and clears the secure session."
      : "Clears the saved URL on this device. Saved servers stay available.";
  const languageOptions = [
    { value: "auto" as LocalePreference, label: t.settings.auto },
    ...options.map((option) => ({
      value: option.code as LocalePreference,
      label: option.label,
    })),
  ];

  return (
    <DrawerScaffold title="Settings" subtitle="Connection and notifications">
      <NativeSection title="Connection">
        <NativeRow
          title={connectionLabel}
          subtitle={connection?.serverUrl ?? "Connect a Busabase server to review changes here."}
          meta={connection ? formatDate(connection.connectedAt) : undefined}
          leading={<Server size={18} color={tokens.mutedForeground} />}
        />
        <NativeRow
          title="Connect another server"
          subtitle="Validate a different self-hosted Busabase URL."
          leading={<Server size={18} color={tokens.mutedForeground} />}
          trailing={<ChevronRight size={18} color={tokens.mutedForeground} />}
          onPress={() =>
            router.push(
              connection?.serverUrl
                ? { pathname: "/connect/self-hosted", params: { serverUrl: connection.serverUrl } }
                : "/connect/self-hosted",
            )
          }
          last={connection?.mode !== "cloud"}
        />
        {connection?.mode === "cloud" ? (
          <NativeRow
            title="Workspace"
            subtitle={
              connection.cloudUser?.email
                ? `Signed in as ${connection.cloudUser.email}`
                : "Choose the active Busabase Cloud space"
            }
            leading={<Server size={18} color={tokens.mutedForeground} />}
            last
          >
            <View style={styles.rowControl}>
              <SpaceSelector />
            </View>
          </NativeRow>
        ) : null}
      </NativeSection>

      {otherServers.length > 0 ? (
        <NativeSection title="Saved servers" caption={`${otherServers.length}`}>
          {otherServers.map((serverUrl, index) => (
            <NativeRow
              key={serverUrl}
              title={serverUrl}
              subtitle="Saved self-hosted server"
              meta={switchingServer === serverUrl ? "Switching" : undefined}
              leading={<Server size={18} color={tokens.mutedForeground} />}
              onPress={() => setSelectedServer(serverUrl)}
              last={index === otherServers.length - 1}
            />
          ))}
        </NativeSection>
      ) : null}

      <NativeSection title="Language">
        <NativeRow
          title={t.settings.language}
          subtitle={t.settings.languageHint}
          leading={<Languages size={18} color={tokens.mutedForeground} />}
          last
        >
          <View style={styles.fullBleedChips}>
            <NativeChipList<LocalePreference>
              value={preference}
              options={languageOptions}
              onChange={setPreference}
            />
          </View>
        </NativeRow>
      </NativeSection>

      <NativeSection title="Notifications">
        <NativeRow
          title="New change requests"
          subtitle={
            supported
              ? "Notify when review work arrives. Background checks run on the system schedule."
              : "Available only in the iOS and Android app."
          }
          leading={<Bell size={18} color={tokens.mutedForeground} />}
          trailing={
            <Switch
              accessibilityLabel="Notify about new change requests"
              value={supported && settings.enabled}
              disabled={!supported}
              trackColor={{ true: tokens.primary }}
              onValueChange={(value) => void setEnabled(value)}
            />
          }
          last={!permissionDenied && !settings.enabled}
        />
        {permissionDenied ? (
          <NativeRow
            title="Open system settings"
            subtitle="Notifications are turned off for this app in system settings."
            destructive
            leading={<Bell size={18} color={tokens.destructive} />}
            onPress={openSystemSettings}
            last={!settings.enabled}
          />
        ) : null}
        {settings.enabled ? (
          <NativeRow title="Check every" subtitle="Foreground polling interval" last>
            <View style={styles.fullBleedChips}>
              <NativeChipList
                value={String(settings.pollIntervalSec)}
                options={intervalOptions.map((option) => ({
                  value: String(option.value),
                  label: option.label,
                }))}
                onChange={(value) => {
                  const next = Number(value) as NotificationSettings["pollIntervalSec"];
                  void setPollInterval(next);
                }}
              />
            </View>
          </NativeRow>
        ) : null}
      </NativeSection>

      {connection ? (
        <NativeSection title="Agent">
          <NativeRow
            title="Agent Skill setup"
            subtitle="Let an AI agent read bases and submit change requests."
            leading={<Sparkles size={18} color={tokens.mutedForeground} />}
            onPress={() => void Linking.openURL(AGENT_SKILL_URL)}
            last
          />
        </NativeSection>
      ) : null}

      <NativeSection title="About">
        <NativeRow
          title="Busabase"
          subtitle="Mobile companion app"
          meta={displayVersion}
          leading={<Shield size={18} color={tokens.mutedForeground} />}
        />
        <NativeRow
          title="Privacy Policy"
          leading={<ExternalLink size={16} color={tokens.mutedForeground} />}
          onPress={() => void Linking.openURL("https://busabase.com/privacy-policy")}
        />
        <NativeRow
          title="Terms of Service"
          leading={<ExternalLink size={16} color={tokens.mutedForeground} />}
          onPress={() => void Linking.openURL(TERMS_URL)}
        />
        <NativeRow
          title="Support"
          leading={<ExternalLink size={16} color={tokens.mutedForeground} />}
          onPress={() => void Linking.openURL(SUPPORT_URL)}
          last
        />
      </NativeSection>

      <NativeSection title="Danger zone">
        <NativeRow
          title="Disconnect this device"
          subtitle={disconnectHint}
          destructive
          leading={<LogOut size={18} color={tokens.destructive} />}
          onPress={() => setDisconnectSheetOpen(true)}
          last
        />
      </NativeSection>

      <NativeBottomSheet
        visible={!!selectedServer}
        title="Saved server"
        description={selectedServer ?? undefined}
        showCloseButton
        onClose={() => setSelectedServer(null)}
        footer={
          <NativeActionBar>
            <Button
              label="Switch to this server"
              loading={selectedServer ? switchingServer === selectedServer : false}
              disabled={!selectedServer || switchingServer !== null}
              fullWidth
              onPress={() => {
                if (selectedServer) {
                  void handleSwitch(selectedServer);
                }
              }}
            />
            <Button
              label="Remove from saved servers"
              variant="destructive"
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              fullWidth
              onPress={() => void handleRemoveSavedServer()}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={switchingServer !== null}
              fullWidth
              onPress={() => setSelectedServer(null)}
            />
          </NativeActionBar>
        }
      />

      <NativeBottomSheet
        visible={disconnectSheetOpen}
        title="Disconnect this device?"
        description={disconnectHint}
        showCloseButton
        onClose={() => setDisconnectSheetOpen(false)}
        footer={
          <NativeActionBar>
            <Button
              label="Disconnect"
              variant="destructive"
              loading={disconnecting}
              fullWidth
              onPress={() => void handleDisconnect()}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={disconnecting}
              fullWidth
              onPress={() => setDisconnectSheetOpen(false)}
            />
          </NativeActionBar>
        }
      />
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
  rowControl: { paddingTop: 8 },
  fullBleedChips: { marginHorizontal: -14, paddingTop: 8 },
});
