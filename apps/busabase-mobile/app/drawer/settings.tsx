import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import {
  Bell,
  Check,
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
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
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
import { fmt, type LocalePreference, useI18n } from "~/i18n";
import { useNotifications } from "~/notifications/notification-provider";
import type { NotificationSettings } from "~/notifications/notification-settings";
import { mobile, radius, spacing, typography } from "~/theme/tokens";
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
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
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
      setAccountError(error instanceof Error ? error.message : t.settings.addAccountFailed);
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
      setAccountError(error instanceof Error ? error.message : t.settings.switchAccountFailed);
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
      setAccountError(error instanceof Error ? error.message : t.settings.removeAccountFailed);
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
        ? t.settings.demoWorkspace
        : t.settings.selfHostedServer
    : t.settings.noServerConnected;
  const disconnectHint =
    connection?.mode === "cloud" ? t.settings.cloudDisconnectHint : t.settings.localDisconnectHint;
  const languageOptions = [
    { value: "auto" as LocalePreference, label: t.settings.auto },
    ...options.map((option) => ({
      value: option.code as LocalePreference,
      label: option.label,
    })),
  ];
  const selectedLanguageLabel =
    languageOptions.find((option) => option.value === preference)?.label ?? t.settings.auto;
  const selectedCloudAccount = cloudAccounts.find(({ id }) => id === selectedAccount) ?? null;
  const sortedCloudAccounts = [...cloudAccounts].sort(
    (left, right) => Number(right.isActive) - Number(left.isActive),
  );
  const cloudAccountLimitReached = cloudAccounts.length >= MAX_CLOUD_ACCOUNTS;

  return (
    <DrawerScaffold title={t.settings.title} contentWidth="readable">
      <NativeSection title={t.settings.connection}>
        <NativeRow
          title={connectionLabel}
          subtitle={connection?.serverUrl ?? t.settings.connectServerHint}
          leading={<Server size={18} color={tokens.mutedForeground} />}
        />
        <NativeRow
          title={t.settings.connectAnotherServer}
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
            title={t.settings.workspace}
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
        <NativeSection
          title={t.settings.accounts}
          caption={`${cloudAccounts.length}/${MAX_CLOUD_ACCOUNTS}`}
        >
          {sortedCloudAccounts.map((account) => {
            const profile = account.user;
            const title = profile?.name || profile?.email || t.settings.savedAccount;
            return (
              <NativeRow
                key={account.id}
                title={title}
                subtitle={profile?.email ?? t.settings.cloudAccount}
                meta={
                  switchingAccount === account.id
                    ? t.settings.working
                    : account.isActive
                      ? t.settings.active
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
            title={
              cloudAccountLimitReached
                ? t.settings.accountLimitReached
                : t.settings.addAnotherAccount
            }
            subtitle={
              cloudAccountLimitReached
                ? fmt(t.settings.accountLimit, { count: MAX_CLOUD_ACCOUNTS })
                : undefined
            }
            meta={addingAccount ? t.settings.openingSignIn : undefined}
            leading={<UserPlus size={18} color={tokens.mutedForeground} />}
            disabled={cloudAccountLimitReached || addingAccount || switchingAccount !== null}
            onPress={() => void handleAddAccount()}
            last={!accountError}
          />
          {accountError ? (
            <NativeRow
              title={t.settings.accountActionFailed}
              subtitle={accountError}
              destructive
              leading={<UserRound size={18} color={tokens.destructive} />}
              last
            />
          ) : null}
        </NativeSection>
      ) : null}

      {otherServers.length > 0 ? (
        <NativeSection title={t.settings.savedServers} caption={`${otherServers.length}`}>
          {otherServers.map((serverUrl, index) => (
            <NativeRow
              key={serverUrl}
              title={serverUrl}
              meta={switchingServer === serverUrl ? t.settings.switching : undefined}
              leading={<Server size={18} color={tokens.mutedForeground} />}
              onPress={() => setSelectedServer(serverUrl)}
              last={index === otherServers.length - 1}
            />
          ))}
        </NativeSection>
      ) : null}

      <NativeSection title={t.settings.preferences}>
        <NativeRow
          title={t.settings.language}
          meta={selectedLanguageLabel}
          leading={<Languages size={18} color={tokens.mutedForeground} />}
          trailing={<ChevronRight size={18} color={tokens.mutedForeground} />}
          onPress={() => setLanguagePickerOpen(true)}
          last
        />
      </NativeSection>

      <NativeBottomSheet
        visible={languagePickerOpen}
        title={t.settings.language}
        showCloseButton
        onClose={() => setLanguagePickerOpen(false)}
      >
        <ScrollView
          nestedScrollEnabled
          style={[styles.languageOptions, { borderColor: tokens.border }]}
        >
          {languageOptions.map((option, index) => {
            const selected = option.value === preference;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.languageOption,
                  index < languageOptions.length - 1
                    ? { borderBottomWidth: StyleSheet.hairlineWidth }
                    : null,
                  {
                    backgroundColor: selected ? tokens.primaryMuted : tokens.surface,
                    borderColor: tokens.border,
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}
                onPress={() => {
                  setPreference(option.value);
                  setLanguagePickerOpen(false);
                }}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    typography.body,
                    styles.languageOptionLabel,
                    { color: tokens.foreground },
                  ]}
                >
                  {option.label}
                </Text>
                {selected ? <Check size={17} color={tokens.foreground} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </NativeBottomSheet>

      {supported || permissionDenied || settings.enabled ? (
        <NativeSection title={t.settings.notifications}>
          <NativeRow
            title={t.settings.newChangeRequests}
            subtitle={
              !isFeatureEnabled("notifications") ? t.settings.disabledReviewBuild : undefined
            }
            leading={<Bell size={18} color={tokens.mutedForeground} />}
            trailing={
              <Switch
                accessibilityLabel={t.settings.notifyAccessibility}
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
              title={t.settings.openSystemSettings}
              subtitle={t.settings.notificationsOff}
              destructive
              leading={<Bell size={18} color={tokens.destructive} />}
              onPress={openSystemSettings}
              last={!settings.enabled}
            />
          ) : null}
          {settings.enabled ? (
            <NativeRow title={t.settings.checkEvery} last>
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

      <NativeSection title={t.settings.automation}>
        <NativeRow
          title={t.settings.vault}
          leading={<Vault size={18} color={tokens.mutedForeground} />}
          onPress={() => router.push("/drawer/settings/vault")}
        />
        <NativeRow
          title={t.settings.webhookRules}
          leading={<Webhook size={18} color={tokens.mutedForeground} />}
          onPress={() => router.push("/drawer/settings/webhook")}
          last
        />
      </NativeSection>

      {connection && isFeatureEnabled("externalAgentManifest") ? (
        <NativeSection title={t.settings.agent}>
          <NativeRow
            title={t.settings.agentSkillSetup}
            leading={<Sparkles size={18} color={tokens.mutedForeground} />}
            onPress={() => void Linking.openURL(AGENT_SKILL_URL)}
            last
          />
        </NativeSection>
      ) : null}

      <NativeSection title={t.settings.about}>
        <NativeRow
          title="Busabase"
          meta={displayVersion}
          leading={<Shield size={18} color={tokens.mutedForeground} />}
        />
        <NativeRow
          title={t.settings.checkForUpdates}
          subtitle={
            updateError
              ? t.settings.updateCheckFailed
              : decision?.latestVersion
                ? fmt(t.settings.latestVersion, { version: decision.latestVersion })
                : undefined
          }
          meta={checking ? t.settings.checking : undefined}
          leading={<Download size={16} color={tokens.mutedForeground} />}
          onPress={() => void checkForUpdates({ manual: true })}
        />
        <NativeRow
          title={t.settings.privacyPolicy}
          leading={<ExternalLink size={16} color={tokens.mutedForeground} />}
          onPress={() => void Linking.openURL("https://busabase.com/privacy-policy")}
        />
        <NativeRow
          title={t.settings.termsOfService}
          leading={<ExternalLink size={16} color={tokens.mutedForeground} />}
          onPress={() => void Linking.openURL(TERMS_URL)}
        />
        <NativeRow
          title={t.settings.support}
          leading={<ExternalLink size={16} color={tokens.mutedForeground} />}
          onPress={() => void Linking.openURL(SUPPORT_URL)}
          last
        />
      </NativeSection>

      <NativeSection title={t.settings.dangerZone}>
        <NativeRow
          title={t.settings.disconnectDevice}
          subtitle={disconnectHint}
          destructive
          leading={<LogOut size={18} color={tokens.destructive} />}
          onPress={() => setDisconnectSheetOpen(true)}
          last
        />
      </NativeSection>

      <NativeBottomSheet
        visible={!!selectedCloudAccount}
        title={selectedCloudAccount?.user?.name || t.settings.cloudAccount}
        description={selectedCloudAccount?.user?.email ?? t.settings.savedOnDevice}
        showCloseButton
        onClose={() => setSelectedAccount(null)}
        footer={
          selectedCloudAccount ? (
            <NativeActionBar>
              {!selectedCloudAccount.isActive ? (
                <Button
                  label={t.settings.switchToAccount}
                  loading={switchingAccount === selectedCloudAccount.id}
                  disabled={switchingAccount !== null}
                  fullWidth
                  onPress={() => void handleSwitchAccount(selectedCloudAccount.id)}
                />
              ) : null}
              <Button
                label={t.settings.removeFromDevice}
                variant="destructive"
                leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
                disabled={switchingAccount !== null}
                fullWidth
                onPress={() => void handleRemoveAccount(selectedCloudAccount.id)}
              />
              <Button
                label={t.common.cancel}
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
        title={t.settings.savedServer}
        description={selectedServer ?? undefined}
        showCloseButton
        onClose={() => setSelectedServer(null)}
        footer={
          <NativeActionBar>
            <Button
              label={t.settings.switchToServer}
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
              label={t.settings.removeSavedServer}
              variant="destructive"
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              fullWidth
              onPress={() => void handleRemoveSavedServer()}
            />
            <Button
              label={t.common.cancel}
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
        title={t.settings.disconnectTitle}
        description={disconnectHint}
        showCloseButton
        onClose={() => setDisconnectSheetOpen(false)}
        footer={
          <NativeActionBar>
            <Button
              label={t.settings.disconnect}
              variant="destructive"
              loading={disconnecting}
              fullWidth
              onPress={() => void handleDisconnect()}
            />
            <Button
              label={t.common.cancel}
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
  languageOptions: {
    maxHeight: 240,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  languageOption: {
    minHeight: mobile.minTouchTarget,
    paddingHorizontal: spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  languageOptionLabel: { flex: 1, minWidth: 0 },
});
