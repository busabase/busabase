import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { useSettingsController } from "../hooks/use-settings-controller";
import { SettingsActionSheets } from "./SettingsActionSheets";
import { SettingsConnectionSections } from "./SettingsConnectionSections";
import { SettingsGeneralSections } from "./SettingsGeneralSections";
import { SettingsLanguageSheet } from "./SettingsLanguageSheet";
import { SettingsNotificationsSection } from "./SettingsNotificationsSection";

function SettingsContent() {
  const controller = useSettingsController();
  const { t, notifications, mobileUpdate } = controller;

  return (
    <DrawerScaffold title={t.settings.title} contentWidth="readable">
      <SettingsConnectionSections
        t={t}
        connection={controller.connection}
        connectionLabel={controller.connectionLabel}
        accounts={controller.cloudAccounts}
        accountLimitReached={controller.cloudAccountLimitReached}
        addingAccount={controller.addingAccount}
        switchingAccount={controller.switchingAccount}
        accountError={controller.accountError}
        otherServers={controller.otherServers}
        switchingServer={controller.switchingServer}
        onConnectAnotherServer={controller.openSelfHostedConnect}
        onSelectAccount={controller.setSelectedAccount}
        onAddAccount={() => void controller.handleAddAccount()}
        onSelectServer={controller.setSelectedServer}
      />

      <SettingsGeneralSections
        t={t}
        selectedLanguageLabel={controller.selectedLanguageLabel}
        displayVersion={controller.displayVersion}
        updateError={mobileUpdate.error}
        latestVersion={mobileUpdate.decision?.latestVersion}
        checkingForUpdates={mobileUpdate.checking}
        showAgentSection={
          !!controller.connection && mobileUpdate.isFeatureEnabled("externalAgentManifest")
        }
        disconnectHint={controller.disconnectHint}
        notificationsSection={
          <SettingsNotificationsSection
            t={t}
            featureEnabled={mobileUpdate.isFeatureEnabled("notifications")}
            supported={notifications.supported}
            permissionDenied={notifications.permissionDenied}
            settings={notifications.settings}
            onEnabledChange={(enabled) => void notifications.setEnabled(enabled)}
            onPollIntervalChange={(interval) => void notifications.setPollInterval(interval)}
            onOpenSystemSettings={notifications.openSystemSettings}
          />
        }
        onOpenLanguage={() => controller.setLanguagePickerOpen(true)}
        onOpenVault={controller.openVault}
        onOpenWebhookRules={controller.openWebhookRules}
        onCheckForUpdates={() => void mobileUpdate.checkForUpdates({ manual: true })}
        onOpenDisconnect={() => controller.setDisconnectSheetOpen(true)}
      />

      <SettingsLanguageSheet
        visible={controller.languagePickerOpen}
        title={t.settings.language}
        preference={controller.preference}
        options={controller.languageOptions}
        onSelect={(preference) => {
          controller.setPreference(preference);
          controller.setLanguagePickerOpen(false);
        }}
        onClose={() => controller.setLanguagePickerOpen(false)}
      />

      <SettingsActionSheets
        t={t}
        selectedAccount={controller.selectedCloudAccount}
        selectedServer={controller.selectedServer}
        disconnectVisible={controller.disconnectSheetOpen}
        disconnectHint={controller.disconnectHint}
        switchingAccount={controller.switchingAccount}
        switchingServer={controller.switchingServer}
        disconnecting={controller.disconnecting}
        onCloseAccount={() => controller.setSelectedAccount(null)}
        onSwitchAccount={(accountId) => void controller.handleSwitchAccount(accountId)}
        onRemoveAccount={(accountId) => void controller.handleRemoveAccount(accountId)}
        onCloseServer={() => controller.setSelectedServer(null)}
        onSwitchServer={(serverUrl) => void controller.handleSwitchServer(serverUrl)}
        onRemoveServer={() => void controller.handleRemoveSavedServer()}
        onCloseDisconnect={() => controller.setDisconnectSheetOpen(false)}
        onDisconnect={() => void controller.handleDisconnect()}
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
