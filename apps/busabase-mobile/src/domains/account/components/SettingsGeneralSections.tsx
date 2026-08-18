import {
  ChevronRight,
  Download,
  ExternalLink,
  Languages,
  LogOut,
  Shield,
  Sparkles,
  Vault,
  Webhook,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { Linking } from "react-native";
import { NativeRow, NativeSection } from "~/components/native-screen";
import { fmt } from "~/i18n";
import type { CoreMessages } from "~/i18n/messages";
import { useTokens } from "~/theme/use-tokens";
import { AGENT_SKILL_URL, PRIVACY_URL, SUPPORT_URL, TERMS_URL } from "../utils/settings";

interface SettingsGeneralSectionsProps {
  t: CoreMessages;
  selectedLanguageLabel: string;
  displayVersion: string;
  updateError: string | null;
  latestVersion?: string | null;
  checkingForUpdates: boolean;
  showAgentSection: boolean;
  disconnectHint: string;
  notificationsSection: ReactNode;
  onOpenLanguage: () => void;
  onOpenVault: () => void;
  onOpenWebhookRules: () => void;
  onCheckForUpdates: () => void;
  onOpenDisconnect: () => void;
}

export function SettingsGeneralSections({
  t,
  selectedLanguageLabel,
  displayVersion,
  updateError,
  latestVersion,
  checkingForUpdates,
  showAgentSection,
  disconnectHint,
  notificationsSection,
  onOpenLanguage,
  onOpenVault,
  onOpenWebhookRules,
  onCheckForUpdates,
  onOpenDisconnect,
}: SettingsGeneralSectionsProps) {
  const tokens = useTokens();

  return (
    <>
      <NativeSection title={t.settings.preferences}>
        <NativeRow
          title={t.settings.language}
          meta={selectedLanguageLabel}
          leading={<Languages size={18} color={tokens.mutedForeground} />}
          trailing={<ChevronRight size={18} color={tokens.mutedForeground} />}
          onPress={onOpenLanguage}
          last
        />
      </NativeSection>

      {notificationsSection}

      <NativeSection title={t.settings.automation}>
        <NativeRow
          title={t.settings.vault}
          leading={<Vault size={18} color={tokens.mutedForeground} />}
          onPress={onOpenVault}
        />
        <NativeRow
          title={t.settings.webhookRules}
          leading={<Webhook size={18} color={tokens.mutedForeground} />}
          onPress={onOpenWebhookRules}
          last
        />
      </NativeSection>

      {showAgentSection ? (
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
              : latestVersion
                ? fmt(t.settings.latestVersion, { version: latestVersion })
                : undefined
          }
          meta={checkingForUpdates ? t.settings.checking : undefined}
          leading={<Download size={16} color={tokens.mutedForeground} />}
          onPress={onCheckForUpdates}
        />
        <ExternalLinkRow title={t.settings.privacyPolicy} url={PRIVACY_URL} />
        <ExternalLinkRow title={t.settings.termsOfService} url={TERMS_URL} />
        <ExternalLinkRow title={t.settings.support} url={SUPPORT_URL} last />
      </NativeSection>

      <NativeSection title={t.settings.dangerZone}>
        <NativeRow
          title={t.settings.disconnectDevice}
          subtitle={disconnectHint}
          destructive
          leading={<LogOut size={18} color={tokens.destructive} />}
          onPress={onOpenDisconnect}
          last
        />
      </NativeSection>
    </>
  );
}

interface ExternalLinkRowProps {
  title: string;
  url: string;
  last?: boolean;
}

function ExternalLinkRow({ title, url, last }: ExternalLinkRowProps) {
  const tokens = useTokens();
  return (
    <NativeRow
      title={title}
      leading={<ExternalLink size={16} color={tokens.mutedForeground} />}
      onPress={() => void Linking.openURL(url)}
      last={last}
    />
  );
}
