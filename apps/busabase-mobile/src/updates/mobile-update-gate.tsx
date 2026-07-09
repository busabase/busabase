import { ExternalLink } from "lucide-react-native";
import { Linking, StyleSheet, Text, View } from "react-native";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { useMobileUpdate } from "./mobile-update-provider";

export function MobileUpdateGate() {
  const tokens = useTokens();
  const { decision, dismissOptionalUpdate } = useMobileUpdate();
  const visible = decision?.action === "force" || decision?.action === "optional";

  if (!visible || !decision) return null;

  const title = decision.action === "force" ? "Update required" : "Update available";
  const description =
    decision.action === "force"
      ? "This version is no longer supported. Update Busabase to continue."
      : "A newer Busabase version is available.";
  const versionLabel = decision.latestVersion ? `v${decision.latestVersion}` : "Latest version";

  const openUpdate = () => {
    if (decision.downloadUrl) {
      void Linking.openURL(decision.downloadUrl);
    }
  };

  return (
    <NativeBottomSheet
      visible
      title={title}
      description={description}
      showCloseButton={decision.action !== "force"}
      onClose={() => {
        if (decision.action !== "force") {
          void dismissOptionalUpdate();
        }
      }}
      footer={
        <NativeActionBar>
          <Button
            label={decision.downloadUrl ? "Update now" : "Open download page"}
            leadingIcon={<ExternalLink size={18} color={tokens.primaryForeground} />}
            fullWidth
            onPress={openUpdate}
          />
          {decision.action === "optional" ? (
            <Button
              label="Later"
              variant="ghost"
              fullWidth
              onPress={() => void dismissOptionalUpdate()}
            />
          ) : null}
        </NativeActionBar>
      }
    >
      <NativeSection>
        <NativeRow title={versionLabel} subtitle={decision.releaseName ?? undefined} last />
      </NativeSection>
      {decision.isReviewBuild ? (
        <View style={[styles.reviewNote, { borderColor: tokens.border }]}>
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            This review build may hide selected features according to the release policy.
          </Text>
        </View>
      ) : null}
    </NativeBottomSheet>
  );
}

const styles = StyleSheet.create({
  reviewNote: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
  },
});
