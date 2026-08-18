import { StyleSheet, View } from "react-native";
import { NativeActionBar, NativeBottomSheet } from "~/components/native-screen";
import { InstallFromGithubSheet } from "~/domains/install/components/InstallFromGithubSheet";
import { useI18n } from "~/i18n";
import { useSpaceSelectorController } from "../hooks/use-space-selector-controller";
import { SpaceSelectorMenuContent, SpaceSelectorRefreshButton } from "./SpaceSelectorMenuContent";
import { SpaceSelectorPopover } from "./SpaceSelectorPopover";
import { SpaceSelectorTrigger } from "./SpaceSelectorTrigger";

interface SpaceSelectorProps {
  compact?: boolean;
  presentation?: "sheet" | "popover";
  /** Close the containing drawer after a route or workspace change. */
  onDismissContainer?: () => void;
}

/**
 * Navigation and workspace switching stay available in every connection mode.
 * Only Cloud renders the remote workspace list and its refresh action.
 */
export function SpaceSelector({
  compact = false,
  presentation = "sheet",
  onDismissContainer,
}: SpaceSelectorProps) {
  const { t } = useI18n();
  const controller = useSpaceSelectorController({ presentation, onDismissContainer });
  const isPopover = presentation === "popover";
  const selectorContent = (
    <SpaceSelectorMenuContent
      isPopover={isPopover}
      pathname={controller.pathname}
      workspace={controller.workspace}
      onNavigate={controller.navigate}
      onOpenInstall={controller.openInstallSheet}
      onRefresh={controller.refreshWorkspaces}
      onSelectWorkspace={(space) => void controller.selectWorkspace(space)}
    />
  );
  const refreshWorkspaces = controller.workspace.isCloud ? (
    <SpaceSelectorRefreshButton
      isFetching={controller.workspace.isFetchingSpaces}
      onRefresh={controller.refreshWorkspaces}
    />
  ) : null;

  return (
    <>
      <View style={isPopover ? styles.popoverRoot : undefined}>
        <SpaceSelectorTrigger
          accessibilityLabel={t.nav.workspace}
          compact={compact}
          isFetchingSpaces={controller.workspace.isFetchingSpaces}
          isPopover={isPopover}
          open={controller.open}
          planLabel={controller.workspace.planLabel}
          subtitle={controller.workspace.triggerSubtitle}
          title={controller.workspace.triggerTitle}
          onPress={controller.toggleMenu}
        />
        {isPopover && controller.open ? (
          <SpaceSelectorPopover
            footer={
              refreshWorkspaces ? <NativeActionBar>{refreshWorkspaces}</NativeActionBar> : null
            }
            subtitle={controller.workspace.triggerSubtitle}
            title={controller.workspace.triggerTitle}
            onClose={controller.closeMenu}
            onOpenSettings={() => controller.navigate("/drawer/settings")}
          >
            {selectorContent}
          </SpaceSelectorPopover>
        ) : null}
      </View>

      {presentation === "sheet" ? (
        <NativeBottomSheet
          visible={controller.open}
          title={t.nav.workspace}
          showCloseButton
          onClose={controller.closeMenu}
          footer={
            refreshWorkspaces ? <NativeActionBar>{refreshWorkspaces}</NativeActionBar> : undefined
          }
        >
          {selectorContent}
        </NativeBottomSheet>
      ) : null}

      <InstallFromGithubSheet
        visible={controller.installOpen}
        onClose={controller.closeInstallSheet}
        onReviewChangeRequests={controller.reviewChangeRequests}
      />
    </>
  );
}

const styles = StyleSheet.create({
  popoverRoot: { position: "relative", zIndex: 20 },
});
