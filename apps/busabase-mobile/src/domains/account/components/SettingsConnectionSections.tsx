import { ChevronRight, CircleCheck, Server, UserPlus, UserRound } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { MAX_CLOUD_ACCOUNTS } from "~/auth/session-store";
import { NativeRow, NativeSection } from "~/components/native-screen";
import type { BusabaseConnection } from "~/connection/types";
import { SpaceSelector } from "~/domains/workspace/components/SpaceSelector";
import { fmt } from "~/i18n";
import type { CoreMessages } from "~/i18n/messages";
import { useTokens } from "~/theme/use-tokens";
import type { SettingsCloudAccount } from "../types/settings";

interface SettingsConnectionSectionsProps {
  t: CoreMessages;
  connection: BusabaseConnection | null;
  connectionLabel: string;
  accounts: SettingsCloudAccount[];
  accountLimitReached: boolean;
  addingAccount: boolean;
  switchingAccount: string | null;
  accountError: string | null;
  otherServers: string[];
  switchingServer: string | null;
  onConnectAnotherServer: () => void;
  onSelectAccount: (accountId: string) => void;
  onAddAccount: () => void;
  onSelectServer: (serverUrl: string) => void;
}

export function SettingsConnectionSections({
  t,
  connection,
  connectionLabel,
  accounts,
  accountLimitReached,
  addingAccount,
  switchingAccount,
  accountError,
  otherServers,
  switchingServer,
  onConnectAnotherServer,
  onSelectAccount,
  onAddAccount,
  onSelectServer,
}: SettingsConnectionSectionsProps) {
  const tokens = useTokens();

  return (
    <>
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
          onPress={onConnectAnotherServer}
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
          caption={`${accounts.length}/${MAX_CLOUD_ACCOUNTS}`}
        >
          {accounts.map((account) => {
            const profile = account.user;
            return (
              <NativeRow
                key={account.id}
                title={profile?.name || profile?.email || t.settings.savedAccount}
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
                onPress={() => onSelectAccount(account.id)}
                last={false}
              />
            );
          })}
          <NativeRow
            title={
              accountLimitReached ? t.settings.accountLimitReached : t.settings.addAnotherAccount
            }
            subtitle={
              accountLimitReached
                ? fmt(t.settings.accountLimit, { count: MAX_CLOUD_ACCOUNTS })
                : undefined
            }
            meta={addingAccount ? t.settings.openingSignIn : undefined}
            leading={<UserPlus size={18} color={tokens.mutedForeground} />}
            disabled={accountLimitReached || addingAccount || switchingAccount !== null}
            onPress={onAddAccount}
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
              onPress={() => onSelectServer(serverUrl)}
              last={index === otherServers.length - 1}
            />
          ))}
        </NativeSection>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  rowControl: { paddingTop: 8 },
});
