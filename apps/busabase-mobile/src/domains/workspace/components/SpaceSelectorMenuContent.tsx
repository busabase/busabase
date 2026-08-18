import { Check, RefreshCw } from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { NativeInlineError, NativeRow, NativeSection } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import type { BusabaseSpace } from "~/connection/types";
import { useI18n } from "~/i18n";
import { useTokens } from "~/theme/use-tokens";
import type { SpaceSelectorWorkspace } from "../hooks/use-space-selector-controller";
import { DRAWER_DESTINATIONS, isDrawerAction, isDrawerItemActive } from "./drawer-nav-destinations";

interface SpaceSelectorMenuContentProps {
  isPopover: boolean;
  pathname: string;
  workspace: SpaceSelectorWorkspace;
  onNavigate: (href: string) => void;
  onOpenInstall: () => void;
  onRefresh: () => void;
  onSelectWorkspace: (space: BusabaseSpace) => void;
}

export function SpaceSelectorMenuContent({
  isPopover,
  pathname,
  workspace,
  onNavigate,
  onOpenInstall,
  onRefresh,
  onSelectWorkspace,
}: SpaceSelectorMenuContentProps) {
  const destinationSection = (
    <DestinationSection pathname={pathname} onNavigate={onNavigate} onOpenInstall={onOpenInstall} />
  );
  const workspaceSection = (
    <WorkspaceSection
      workspace={workspace}
      onRefresh={onRefresh}
      onSelectWorkspace={onSelectWorkspace}
    />
  );

  return (
    <>
      {isPopover ? workspaceSection : destinationSection}
      {isPopover ? destinationSection : workspaceSection}
    </>
  );
}

interface DestinationSectionProps {
  pathname: string;
  onNavigate: (href: string) => void;
  onOpenInstall: () => void;
}

function DestinationSection({ pathname, onNavigate, onOpenInstall }: DestinationSectionProps) {
  const tokens = useTokens();
  const { t } = useI18n();

  return (
    <NativeSection title={t.nav.goTo}>
      {DRAWER_DESTINATIONS.map((destination, index) => {
        const active = isDrawerItemActive(pathname, destination);
        const Icon = destination.icon;
        return (
          <NativeRow
            key={destination.key}
            title={t.nav[destination.key]}
            leading={<Icon size={18} color={active ? tokens.primary : tokens.mutedForeground} />}
            trailing={active ? <Check size={18} color={tokens.primary} /> : undefined}
            last={index === DRAWER_DESTINATIONS.length - 1}
            onPress={() =>
              isDrawerAction(destination) ? onOpenInstall() : onNavigate(destination.href)
            }
          />
        );
      })}
    </NativeSection>
  );
}

interface WorkspaceSectionProps {
  workspace: SpaceSelectorWorkspace;
  onRefresh: () => void;
  onSelectWorkspace: (space: BusabaseSpace) => void;
}

function WorkspaceSection({ workspace, onRefresh, onSelectWorkspace }: WorkspaceSectionProps) {
  const tokens = useTokens();
  const { t } = useI18n();

  if (!workspace.isCloud) {
    return (
      <NativeSection title={t.nav.workspaces}>
        <NativeRow
          title={workspace.triggerTitle}
          subtitle={workspace.serverUrl}
          trailing={<Check size={18} color={tokens.primary} />}
          last
        />
      </NativeSection>
    );
  }

  return (
    <>
      {workspace.hasLoadError ? (
        <View style={styles.inlineErrorWrap}>
          <NativeInlineError message={t.workspaceSelector.loadError} onReset={onRefresh} />
        </View>
      ) : null}
      <NativeSection
        title={t.nav.workspaces}
        caption={workspace.spaces.length > 0 ? `${workspace.spaces.length}` : undefined}
      >
        {workspace.spaces.length === 0 ? (
          <NativeRow
            title={
              workspace.isLoadingSpaces
                ? t.workspaceSelector.loadingWorkspaces
                : t.workspaceSelector.noWorkspaces
            }
            subtitle={workspace.isLoadingSpaces ? undefined : t.workspaceSelector.reconnectHint}
            last
          />
        ) : (
          workspace.spaces.map((space, index) => {
            const active = workspace.activeSpace?.id === space.id;
            return (
              <NativeRow
                key={space.id}
                title={space.name}
                subtitle={[space.slug ? `@${space.slug}` : null, space.plan]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={active ? <Check size={18} color={tokens.primary} /> : undefined}
                last={index === workspace.spaces.length - 1}
                onPress={() => onSelectWorkspace(space)}
              />
            );
          })
        )}
      </NativeSection>
    </>
  );
}

interface SpaceSelectorRefreshButtonProps {
  isFetching: boolean;
  onRefresh: () => void;
}

export function SpaceSelectorRefreshButton({
  isFetching,
  onRefresh,
}: SpaceSelectorRefreshButtonProps): ReactNode {
  const tokens = useTokens();
  const { t } = useI18n();

  return (
    <Button
      label={isFetching ? t.workspaceSelector.refreshing : t.workspaceSelector.refresh}
      variant="secondary"
      loading={isFetching}
      fullWidth
      leadingIcon={<RefreshCw size={18} color={tokens.foreground} />}
      onPress={onRefresh}
    />
  );
}

const styles = StyleSheet.create({
  inlineErrorWrap: { marginHorizontal: 20, marginTop: 10 },
});
