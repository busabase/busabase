import type { InstallResultVO } from "busabase-contract/domains/install/types";
import { CircleCheck } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { fmt, useI18n } from "~/i18n";
import { spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { InstallNotice } from "./InstallNotice";

export function InstallResultStep({ result }: { result: InstallResultVO }) {
  const { t } = useI18n();
  const tokens = useTokens();
  return (
    <>
      <View style={styles.titleRow}>
        <CircleCheck size={18} color={tokens.merged.text} />
        <Text style={[typography.bodyEm, styles.title, { color: tokens.foreground }]}>
          {fmt(t.install.resultTitle, { folder: result.targetFolderSlug })}
        </Text>
      </View>
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>
        {fmt(t.install.resultCounts, {
          folders: result.created.folders,
          bases: result.created.bases,
          views: result.created.views,
          docs: result.created.docs,
          records: result.created.records,
          files: result.created.files,
        })}
      </Text>

      {result.pendingChangeRequests > 0 ? (
        <InstallNotice
          body={t.install.pendingBody}
          title={fmt(t.install.pendingTitle, { count: result.pendingChangeRequests })}
        />
      ) : (
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          {t.install.noPending}
        </Text>
      )}

      {result.warnings.length > 0 ? (
        <InstallNotice lines={result.warnings} title={t.install.warningsTitle} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  title: { flex: 1, minWidth: 0 },
});
