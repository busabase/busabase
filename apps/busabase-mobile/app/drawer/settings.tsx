import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import {
  Bell,
  ChevronRight,
  CircleCheck,
  Download,
  ExternalLink,
  Languages,
  LogOut,
  Server,
  Shield,
  Sparkles,
  Trash2,
  UserPlus,
  UserRound,
  Vault,
  Webhook,
} from "lucide-react-native";
import { useState } from "react";
import { Linking, StyleSheet, Switch, View } from "react-native";
import { signInWithBusabaseCloud } from "~/auth/oauth";
import { MAX_CLOUD_ACCOUNTS } from "~/auth/session-store";
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
import { useNotifications } from "~/notifications/notification-provider";
import type { NotificationSettings } from "~/notifications/notification-settings";
import { useTokens } from "~/theme/use-tokens";
import { useMobileUpdate } from "~/updates/mobile-update-provider";

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
  const queryClient = useQueryClient();
  const tokens = useTokens();
  const { t, preference, setPreference, options } = useI18n();
  const {
    state,
    cloudAccounts,
    connectCloud,
    disconnect,
    connectSelfHosted,
    removeCloudAccount,
    removeServerFromHistory,
    switchCloudAccount,
  } = useConnection();
  const { supported, settings, permissionDenied, setEnabled, setPollInterval, openSystemSettings } =
    useNotifications();
  const {
    checking,
    decision,
    error: updateError,
    checkForUpdates,
    isFeatureEnabled,
  } = useMobileUpdate();
  const [switchingServer, setSwitchingServer] = useState<string | null>(null);
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [disconnectSheetOpen, setDisconnectSheetOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const connection = state.status === "connected" ? state.connection : null;
  const otherServers = state.serverHistory.filter((url) => url !== connection?.serverUrl);
  const displayVersion = getDisplayVersion();

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnect();
      queryClient.clear();
      setDisconnectSheetOpen(false);
      router.replace("/");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleAddAccount = async () => {
    setAccountError(null);
    setAddingAccount(true);
    try {
      const session = await signInWithBusabaseCloud();
      await connectCloud(session);
      queryClient.clear();
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Could not add this account.");
    } finally {
      setAddingAccount(false);
    }
  };

  const handleSwitchAccount = async (accountId: string) => {
    setAccountError(null);
    setSwitchingAccount(accountId);
    try {
      await switchCloudAccount(accountId);
      queryClient.clear();
      setSelectedAccount(null);
      router.replace("/drawer/inbox");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Could not switch accounts.");
    } finally {
      setSwitchingAccount(null);
    }
  };

  const handleRemoveAccount = async (accountId: string) => {
    setAccountError(null);
    setSwitchingAccount(accountId);
    try {
      await removeCloudAccount(accountId);
      queryClient.clear();
      setSelectedAccount(null);
      if (cloudAccounts.length === 1) {
        router.replace("/");
      } else {
        router.replace("/drawer/inbox");
      }
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Could not remove this account.");
    } finally {
      setSwitchingAccount(null);
    }
  };

  const handleSwitch = async (serverUrl: string) => {
    setSwitchingServer(serverUrl);
    try {
      await connectSelfHosted(serverUrl);
      setSelectedServer(null);
      router.replace("/drawer/home");
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
      ? "Signs every saved account out of Busabase Cloud and clears secure sessions."
      : "Clears the saved URL on this device. Saved servers stay available.";
  const languageOptions = [
    { value: "auto" as LocalePreference, label: t.settings.auto },
    ...options.map((option) => ({
      value: option.code as LocalePreference,
      label: option.label,
    })),
  ];
  const selectedCloudAccount = cloudAccounts.find(({ id }) => id === selectedAccount) ?? null;
  const sortedCloudAccounts = [...cloudAccounts].sort(
    (left, right) => Number(right.isActive) - Number(left.isActive),
  );
  const cloudAccountLimitReached = cloudAccounts.length >= MAX_CLOUD_ACCOUNTS;

  return (
    <DrawerScaffold title="Settings">
      <NativeSection title="Connection">
        <NativeRow
          title={connectionLabel}
          subtitle={connection?.serverUrl ?? "Connect a Busabase server to review changes here."}
          leading={<Server size={18} color={tokens.mutedForeground} />}
        />
        <NativeRow
          title="Connect another server"
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
            leading={<Server size={18} color={tokens.mutedForeground} />}
            last
          >
            <View style={styles.rowControl}>
              <SpaceSelector />
            </View>
          </NativeRow>
        ) : null}
      </NativeSection>

      {connection?.mode === "cloud" ? (
        <NativeSection title="Accounts" caption={`${cloudAccounts.length}/${MAX_CLOUD_ACCOUNTS}`}>
          {sortedCloudAccounts.map((account) => {
            const profile = account.user;
            const title = profile?.name || profile?.email || "Saved account";
            return (
              <NativeRow
                key={account.id}
                title={title}
                subtitle={profile?.email ?? "Busabase Cloud account"}
                meta={
                  switchingAccount === account.id
                    ? "Working"
                    : account.isActive
                      ? "Active"
                      : undefined
                }
                leading={<UserRound size={18} color={tokens.mutedForeground} />}
                trailing={
                  account.isActive ? <CircleCheck size={18} color={tokens.success} /> : undefined
                }
                disabled={switchingAccount !== null}
                onPress={() => setSelectedAccount(account.id)}
                last={false}
              />
            );
          })}
          <NativeRow
            title={cloudAccountLimitReached ? "Account limit reached" : "Add another account"}
            subtitle={
              cloudAccountLimitReached ? `Up to ${MAX_CLOUD_ACCOUNTS} accounts.` : undefined
            }
            meta={addingAccount ? "Opening sign in" : undefined}
            leading={<UserPlus size={18} color={tokens.mutedForeground} />}
            disabled={cloudAccountLimitReached || addingAccount || switchingAccount !== null}
            onPress={() => void handleAddAccount()}
            last={!accountError}
          />
          {accountError ? (
            <NativeRow
              title="Account action failed"
              subtitle={accountError}
              destructive
              leading={<UserRound size={18} color={tokens.destructive} />}
              last
            />
          ) : null}
        </NativeSection>
      ) : null}

      {otherServers.length > 0 ? (
        <NativeSection title="Saved servers" caption={`${otherServers.length}`}>
          {otherServers.map((serverUrl, index) => (
            <NativeRow
              key={serverUrl}
              title={serverUrl}
              meta={switchingServer === serverUrl ? "Switching" : undefined}
              leading={<Server size={18} color={tokens.mutedForeground} />}
              onPress={() => setSelectedServer(serverUrl)}
              last={index === otherServers.length - 1}
            />
          ))}
        </NativeSection>
      ) : null}

      <NativeSection title="Preferences">
        <NativeRow
          title={t.settings.language}
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

      {supported || permissionDenied || settings.enabled ? (
        <NativeSection title="Notifications">
          <NativeRow
            title="New change requests"
            subtitle={
              !isFeatureEnabled("notifications") ? "Disabled for this review build." : undefined
            }
            leading={<Bell size={18} color={tokens.mutedForeground} />}
            trailing={
              <Switch
                accessibilityLabel="Notify about new change requests"
                value={isFeatureEnabled("notifications") && supported && settings.enabled}
                disabled={!supported || !isFeatureEnabled("notifications")}
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
            <NativeRow title="Check every" last>
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
      ) : null}

      <NativeSection title="Automation">
        <NativeRow
          title="Vault"
          leading={<Vault size={18} color={tokens.mutedForeground} />}
          onPress={() => router.push("/drawer/settings/vault")}
        />
        <NativeRow
          title="Webhook Rules"
          leading={<Webhook size={18} color={tokens.mutedForeground} />}
          onPress={() => router.push("/drawer/settings/webhook")}
          last
        />
      </NativeSection>

      {connection && isFeatureEnabled("externalAgentManifest") ? (
        <NativeSection title="Agent">
          <NativeRow
            title="Agent Skill setup"
            leading={<Sparkles size={18} color={tokens.mutedForeground} />}
            onPress={() => void Linking.openURL(AGENT_SKILL_URL)}
            last
          />
        </NativeSection>
      ) : null}

      <NativeSection title="About">
        <NativeRow
          title="Busabase"
          meta={displayVersion}
          leading={<Shield size={18} color={tokens.mutedForeground} />}
        />
        <NativeRow
          title="Check for updates"
          subtitle={
            updateError
              ? "Could not check the latest version."
              : decision?.latestVersion
                ? `Latest version v${decision.latestVersion}`
                : undefined
          }
          meta={checking ? "Checking" : undefined}
          leading={<Download size={16} color={tokens.mutedForeground} />}
          onPress={() => void checkForUpdates({ manual: true })}
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
        visible={!!selectedCloudAccount}
        title={selectedCloudAccount?.user?.name || "Busabase Cloud account"}
        description={selectedCloudAccount?.user?.email ?? "Saved on this device"}
        showCloseButton
        onClose={() => setSelectedAccount(null)}
        footer={
          selectedCloudAccount ? (
            <NativeActionBar>
              {!selectedCloudAccount.isActive ? (
                <Button
                  label="Switch to this account"
                  loading={switchingAccount === selectedCloudAccount.id}
                  disabled={switchingAccount !== null}
                  fullWidth
                  onPress={() => void handleSwitchAccount(selectedCloudAccount.id)}
                />
              ) : null}
              <Button
                label="Remove from this device"
                variant="destructive"
                leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
                disabled={switchingAccount !== null}
                fullWidth
                onPress={() => void handleRemoveAccount(selectedCloudAccount.id)}
              />
              <Button
                label="Cancel"
                variant="ghost"
                disabled={switchingAccount !== null}
                fullWidth
                onPress={() => setSelectedAccount(null)}
              />
            </NativeActionBar>
          ) : undefined
        }
      />

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
