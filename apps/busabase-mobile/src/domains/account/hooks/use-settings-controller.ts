import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useState } from "react";
import { signInWithBusabaseCloud } from "~/auth/oauth";
import { MAX_CLOUD_ACCOUNTS } from "~/auth/session-store";
import { useConnection } from "~/connection/connection-store";
import { useI18n } from "~/i18n";
import { useNotifications } from "~/notifications/notification-provider";
import { useMobileUpdate } from "~/updates/mobile-update-provider";
import { buildLanguageOptions, sortCloudAccounts } from "../utils/settings";

const getDisplayVersion = () => {
  const version = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "—";
  const buildNumber =
    Constants.nativeBuildVersion ??
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode?.toString();
  return buildNumber ? `v${version}-${buildNumber}` : `v${version}`;
};

export const useSettingsController = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
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
  const notifications = useNotifications();
  const mobileUpdate = useMobileUpdate();
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
  const languageOptions = buildLanguageOptions(t.settings.auto, options);
  const selectedLanguageLabel =
    languageOptions.find((option) => option.value === preference)?.label ?? t.settings.auto;
  const selectedCloudAccount = cloudAccounts.find(({ id }) => id === selectedAccount) ?? null;
  const sortedCloudAccounts = sortCloudAccounts(cloudAccounts);
  const cloudAccountLimitReached = cloudAccounts.length >= MAX_CLOUD_ACCOUNTS;
  const connectionLabel = connection
    ? connection.mode === "cloud"
      ? "Busabase Cloud"
      : connection.mode === "demo"
        ? t.settings.demoWorkspace
        : t.settings.selfHostedServer
    : t.settings.noServerConnected;
  const disconnectHint =
    connection?.mode === "cloud" ? t.settings.cloudDisconnectHint : t.settings.localDisconnectHint;

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
      router.replace(cloudAccounts.length === 1 ? "/" : "/drawer/inbox");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : t.settings.removeAccountFailed);
    } finally {
      setSwitchingAccount(null);
    }
  };

  const handleSwitchServer = async (serverUrl: string) => {
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

  const openSelfHostedConnect = () =>
    router.push(
      connection?.serverUrl
        ? { pathname: "/connect/self-hosted", params: { serverUrl: connection.serverUrl } }
        : "/connect/self-hosted",
    );

  return {
    t,
    connection,
    connectionLabel,
    disconnectHint,
    displayVersion: getDisplayVersion(),
    cloudAccounts: sortedCloudAccounts,
    cloudAccountLimitReached,
    selectedCloudAccount,
    selectedAccount,
    setSelectedAccount,
    addingAccount,
    switchingAccount,
    accountError,
    otherServers,
    selectedServer,
    setSelectedServer,
    switchingServer,
    disconnectSheetOpen,
    setDisconnectSheetOpen,
    disconnecting,
    preference,
    setPreference,
    languageOptions,
    selectedLanguageLabel,
    languagePickerOpen,
    setLanguagePickerOpen,
    notifications,
    mobileUpdate,
    openSelfHostedConnect,
    openVault: () => router.push("/drawer/settings/vault"),
    openWebhookRules: () => router.push("/drawer/settings/webhook"),
    handleAddAccount,
    handleSwitchAccount,
    handleRemoveAccount,
    handleSwitchServer,
    handleRemoveSavedServer,
    handleDisconnect,
  };
};
