import { useRouter } from "expo-router";
import { ArrowLeft, Save } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";
import {
  NativeActionBar,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { useVaultSettingsController } from "../hooks/use-vault-settings-controller";
import { VaultClearSheet } from "./VaultClearSheet";
import { VaultItemEditorSheet } from "./VaultItemEditorSheet";
import { VaultItemSections } from "./VaultItemSections";

function VaultSettingsContent() {
  const router = useRouter();
  const tokens = useTokens();
  const controller = useVaultSettingsController();
  const { clearMutation, updateMutation, vaultQuery } = controller;
  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/drawer/settings"));

  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={mobile.hitSlop}
      style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={goBack}
    >
      <ArrowLeft size={22} color={tokens.foreground} />
    </Pressable>
  );

  return (
    <DrawerScaffold
      title="Vault"
      contentWidth="readable"
      headerLeading={headerLeading}
      refreshing={vaultQuery.isRefetching}
      onRefresh={() => void vaultQuery.refetch()}
      footer={
        !vaultQuery.isLoading &&
        !vaultQuery.error &&
        (controller.hasChanges || updateMutation.error) ? (
          <NativeActionBar>
            {updateMutation.error ? (
              <NativeInlineError
                message={updateMutation.error.message}
                onReset={() => updateMutation.reset()}
              />
            ) : null}
            <Button
              label={updateMutation.isPending ? "Saving..." : "Save changes"}
              loading={updateMutation.isPending}
              disabled={updateMutation.isPending || !controller.hasChanges}
              fullWidth
              leadingIcon={<Save size={18} color={tokens.primaryForeground} />}
              onPress={controller.save}
            />
          </NativeActionBar>
        ) : undefined
      }
    >
      {vaultQuery.isLoading ? <NativeLoadingState label="Loading vault" /> : null}
      {vaultQuery.error ? (
        <NativeErrorState
          message={vaultQuery.error.message}
          onRetry={() => void vaultQuery.refetch()}
        />
      ) : null}

      {!vaultQuery.isLoading && !vaultQuery.error ? (
        <VaultItemSections
          destructiveColor={tokens.destructive}
          mutedColor={tokens.mutedForeground}
          primaryColor={tokens.primary}
          rows={controller.rows}
          secrets={controller.secrets}
          showSecrets={controller.showSecrets}
          variables={controller.variables}
          onClear={() => controller.setClearConfirmOpen(true)}
          onCreate={controller.openCreate}
          onEdit={controller.openEdit}
          onShowSecretsChange={controller.setShowSecrets}
        />
      ) : null}

      <VaultItemEditorSheet
        draft={controller.draft}
        showSecrets={controller.showSecrets}
        onClose={controller.closeDraft}
        onCommit={controller.commitDraft}
        onRemove={controller.removeDraft}
        onUpdate={controller.updateDraftRow}
      />
      <VaultClearSheet
        error={clearMutation.error}
        pending={clearMutation.isPending}
        visible={controller.clearConfirmOpen}
        onClear={() => clearMutation.mutate()}
        onClose={() => controller.setClearConfirmOpen(false)}
        onResetError={() => clearMutation.reset()}
      />
    </DrawerScaffold>
  );
}

export default function VaultSettingsScreen() {
  return (
    <ConnectionGuard>
      <VaultSettingsContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
