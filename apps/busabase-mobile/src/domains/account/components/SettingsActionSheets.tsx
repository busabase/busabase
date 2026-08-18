import { Trash2 } from "lucide-react-native";
import { NativeActionBar, NativeBottomSheet } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import type { CoreMessages } from "~/i18n/messages";
import { useTokens } from "~/theme/use-tokens";
import type { SettingsCloudAccount } from "../types/settings";

interface SettingsActionSheetsProps {
  t: CoreMessages;
  selectedAccount: SettingsCloudAccount | null;
  selectedServer: string | null;
  disconnectVisible: boolean;
  disconnectHint: string;
  switchingAccount: string | null;
  switchingServer: string | null;
  disconnecting: boolean;
  onCloseAccount: () => void;
  onSwitchAccount: (accountId: string) => void;
  onRemoveAccount: (accountId: string) => void;
  onCloseServer: () => void;
  onSwitchServer: (serverUrl: string) => void;
  onRemoveServer: () => void;
  onCloseDisconnect: () => void;
  onDisconnect: () => void;
}

export function SettingsActionSheets({
  t,
  selectedAccount,
  selectedServer,
  disconnectVisible,
  disconnectHint,
  switchingAccount,
  switchingServer,
  disconnecting,
  onCloseAccount,
  onSwitchAccount,
  onRemoveAccount,
  onCloseServer,
  onSwitchServer,
  onRemoveServer,
  onCloseDisconnect,
  onDisconnect,
}: SettingsActionSheetsProps) {
  const tokens = useTokens();

  return (
    <>
      <NativeBottomSheet
        visible={!!selectedAccount}
        title={selectedAccount?.user?.name || t.settings.cloudAccount}
        description={selectedAccount?.user?.email ?? t.settings.savedOnDevice}
        showCloseButton
        onClose={onCloseAccount}
        footer={
          selectedAccount ? (
            <NativeActionBar>
              {!selectedAccount.isActive ? (
                <Button
                  label={t.settings.switchToAccount}
                  loading={switchingAccount === selectedAccount.id}
                  disabled={switchingAccount !== null}
                  fullWidth
                  onPress={() => onSwitchAccount(selectedAccount.id)}
                />
              ) : null}
              <Button
                label={t.settings.removeFromDevice}
                variant="destructive"
                leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
                disabled={switchingAccount !== null}
                fullWidth
                onPress={() => onRemoveAccount(selectedAccount.id)}
              />
              <Button
                label={t.common.cancel}
                variant="ghost"
                disabled={switchingAccount !== null}
                fullWidth
                onPress={onCloseAccount}
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
        onClose={onCloseServer}
        footer={
          <NativeActionBar>
            <Button
              label={t.settings.switchToServer}
              loading={selectedServer ? switchingServer === selectedServer : false}
              disabled={!selectedServer || switchingServer !== null}
              fullWidth
              onPress={() => selectedServer && onSwitchServer(selectedServer)}
            />
            <Button
              label={t.settings.removeSavedServer}
              variant="destructive"
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              fullWidth
              onPress={onRemoveServer}
            />
            <Button
              label={t.common.cancel}
              variant="ghost"
              disabled={switchingServer !== null}
              fullWidth
              onPress={onCloseServer}
            />
          </NativeActionBar>
        }
      />

      <NativeBottomSheet
        visible={disconnectVisible}
        title={t.settings.disconnectTitle}
        description={disconnectHint}
        showCloseButton
        onClose={onCloseDisconnect}
        footer={
          <NativeActionBar>
            <Button
              label={t.settings.disconnect}
              variant="destructive"
              loading={disconnecting}
              fullWidth
              onPress={onDisconnect}
            />
            <Button
              label={t.common.cancel}
              variant="ghost"
              disabled={disconnecting}
              fullWidth
              onPress={onCloseDisconnect}
            />
          </NativeActionBar>
        }
      />
    </>
  );
}
