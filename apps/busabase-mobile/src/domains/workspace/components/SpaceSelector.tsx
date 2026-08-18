import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "expo-router";
import { Check, ChevronsUpDown, Database, RefreshCw, Settings, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { createCloudSpacesClient } from "~/api/cloud-spaces";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeInlineError,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useConnection } from "~/connection/connection-store";
import type { BusabaseSpace } from "~/connection/types";
import { InstallFromGithubSheet } from "~/domains/install/components/InstallFromGithubSheet";
import { useI18n } from "~/i18n";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { DRAWER_DESTINATIONS, isDrawerAction, isDrawerItemActive } from "./drawer-nav-destinations";

interface SpaceSelectorProps {
  compact?: boolean;
  presentation?: "sheet" | "popover";
  /** Close the containing drawer after a route or workspace change. */
  onDismissContainer?: () => void;
}

/**
 * The Space Selector menu, mirroring the web dashboard's: it holds BOTH the
 * top-level destinations (Inbox · Activity · Trash · Assets · Records ·
 * Bases · Graph View) and — on Busabase Cloud — the workspace switcher.
 *
 * The trigger and menu render in EVERY connection mode. Only the
 * "Available workspaces" list and its refresh footer are cloud-only; self-hosted
 * and demo connections have exactly one workspace, so they get its name as a
 * static line instead. Gating the whole component on `mode === "cloud"` (as it
 * used to) would now leave those users with no way to reach any destination.
 */
export function SpaceSelector({
  compact = false,
  presentation = "sheet",
  onDismissContainer,
}: SpaceSelectorProps) {
  const tokens = useTokens();
  const { height } = useWindowDimensions();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { getCloudAuthorizationHeaders, selectSpace, state } = useConnection();
  const [open, setOpen] = useState(false);
  // The install flow is a separate Modal, so close this menu and its optional
  // containing drawer before handing off to it.
  const [installOpen, setInstallOpen] = useState(false);
  const connection = state.status === "connected" ? state.connection : null;
  const selectedSpace = connection?.selectedSpace ?? null;
  const isCloud = connection?.mode === "cloud";

  const spacesQuery = useQuery({
    queryKey: ["space-selector", connection?.serverUrl, connection?.cloudUser?.id],
    // Never fires outside Busabase Cloud: spaces.list belongs to the Cloud
    // router, and a self-hosted server does not expose it.
    enabled: isCloud,
    queryFn: async () => {
      if (!connection?.serverUrl) {
        throw new Error("No Busabase Cloud connection");
      }
      const client = createCloudSpacesClient(connection.serverUrl, () =>
        getCloudAuthorizationHeaders({ spaceId: null }),
      );
      return client.spaces.list();
    },
  });

  const spaces = spacesQuery.data ?? [];
  const activeSpace = selectedSpace ?? spaces[0] ?? null;
  const isLoadingSpaces = isCloud && spacesQuery.isLoading;
  const isFetchingSpaces = isCloud && spacesQuery.isFetching;

  const staticWorkspaceName =
    connection?.mode === "demo"
      ? t.workspaceSelector.demoWorkspace
      : t.workspaceSelector.selfHostedWorkspace;
  const triggerTitle = isCloud
    ? (activeSpace?.name ?? (isLoadingSpaces ? t.nav.workspaceLoading : t.nav.workspace))
    : (activeSpace?.name ?? staticWorkspaceName);
  const triggerSubtitle = isCloud
    ? spaces.length > 1
      ? `${spaces.length} ${t.nav.workspaces}`
      : activeSpace?.slug
        ? `@${activeSpace.slug}`
        : "Busabase Cloud"
    : (connection?.serverUrl ?? staticWorkspaceName);
  const planLabel = isCloud
    ? (activeSpace?.plan ?? "Cloud")
    : connection?.mode === "demo"
      ? "Demo"
      : "Local";

  const handleSelect = async (space: BusabaseSpace) => {
    await selectSpace(space);
    queryClient.clear();
    setOpen(false);
    onDismissContainer?.();
    router.replace("/drawer/home");
  };

  const navigate = (href: string) => {
    setOpen(false);
    onDismissContainer?.();
    router.replace(href as never);
  };

  const openInstallSheet = () => {
    setOpen(false);
    onDismissContainer?.();
    setInstallOpen(true);
  };

  const isPopover = presentation === "popover";

  const destinationSection = (
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
              isDrawerAction(destination) ? openInstallSheet() : navigate(destination.href)
            }
          />
        );
      })}
    </NativeSection>
  );

  const workspaceSection = (
    <>
      {isCloud ? (
        <>
          {spacesQuery.error ? (
            <View style={styles.inlineErrorWrap}>
              <NativeInlineError
                message={t.workspaceSelector.loadError}
                onReset={() => void spacesQuery.refetch()}
              />
            </View>
          ) : null}
          <NativeSection
            title={t.nav.workspaces}
            caption={spaces.length > 0 ? `${spaces.length}` : undefined}
          >
            {spaces.length === 0 ? (
              <NativeRow
                title={
                  isLoadingSpaces
                    ? t.workspaceSelector.loadingWorkspaces
                    : t.workspaceSelector.noWorkspaces
                }
                subtitle={isLoadingSpaces ? undefined : t.workspaceSelector.reconnectHint}
                last
              />
            ) : (
              spaces.map((space, index) => {
                const active = activeSpace?.id === space.id;
                return (
                  <NativeRow
                    key={space.id}
                    title={space.name}
                    subtitle={[space.slug ? `@${space.slug}` : null, space.plan]
                      .filter(Boolean)
                      .join(" · ")}
                    trailing={active ? <Check size={18} color={tokens.primary} /> : undefined}
                    last={index === spaces.length - 1}
                    onPress={() => void handleSelect(space)}
                  />
                );
              })
            )}
          </NativeSection>
        </>
      ) : (
        <NativeSection title={t.nav.workspaces}>
          <NativeRow
            title={triggerTitle}
            subtitle={connection?.serverUrl}
            trailing={<Check size={18} color={tokens.primary} />}
            last
          />
        </NativeSection>
      )}
    </>
  );

  const selectorContent = (
    <>
      {isPopover ? workspaceSection : destinationSection}
      {isPopover ? destinationSection : workspaceSection}
    </>
  );

  const refreshWorkspaces = isCloud ? (
    <Button
      label={isFetchingSpaces ? t.workspaceSelector.refreshing : t.workspaceSelector.refresh}
      variant="secondary"
      loading={isFetchingSpaces}
      fullWidth
      leadingIcon={<RefreshCw size={18} color={tokens.foreground} />}
      onPress={() => void spacesQuery.refetch()}
    />
  ) : null;

  return (
    <>
      <View style={isPopover ? styles.popoverRoot : undefined}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.nav.workspace}
          accessibilityState={{ expanded: open }}
          style={[
            compact ? styles.compactButton : styles.button,
            isPopover ? styles.sidebarButton : null,
            {
              backgroundColor: open
                ? tokens.primaryMuted
                : isPopover
                  ? "transparent"
                  : tokens.primaryMuted,
            },
          ]}
          onPress={() => setOpen((current) => (isPopover ? !current : true))}
        >
          {isPopover ? (
            <View style={[styles.workspaceLogo, { backgroundColor: tokens.primary }]}>
              <Database size={18} color={tokens.primaryForeground} />
            </View>
          ) : null}
          <View style={styles.buttonText}>
            <Text
              numberOfLines={1}
              style={[compact ? typography.small : typography.bodyEm, { color: tokens.foreground }]}
            >
              {triggerTitle}
            </Text>
            {compact ? null : isPopover ? (
              <View
                style={[
                  styles.planBadge,
                  { backgroundColor: tokens.muted, borderColor: tokens.border },
                ]}
              >
                <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                  {planLabel}
                </Text>
              </View>
            ) : (
              <Text numberOfLines={1} style={[typography.small, { color: tokens.mutedForeground }]}>
                {triggerSubtitle}
              </Text>
            )}
          </View>
          {isFetchingSpaces ? (
            <RefreshCw size={16} color={tokens.mutedForeground} />
          ) : (
            <ChevronsUpDown size={18} color={tokens.mutedForeground} />
          )}
        </Pressable>

        {isPopover && open ? (
          <View
            style={[
              styles.popover,
              {
                backgroundColor: tokens.surface,
                borderColor: tokens.border,
                maxHeight: Math.min(Math.max(height - 128, 360), 620),
              },
            ]}
          >
            <View style={[styles.popoverHeader, { borderColor: tokens.border }]}>
              <View style={styles.popoverIdentity}>
                <View style={[styles.workspaceLogoLarge, { backgroundColor: tokens.primary }]}>
                  <Database size={20} color={tokens.primaryForeground} />
                </View>
                <View style={styles.buttonText}>
                  <Text numberOfLines={1} style={[typography.bodyEm, { color: tokens.foreground }]}>
                    {triggerTitle}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[typography.small, { color: tokens.mutedForeground }]}
                  >
                    {triggerSubtitle}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.workspaceSelector.closeMenu}
                  hitSlop={mobile.hitSlop}
                  style={styles.iconButton}
                  onPress={() => setOpen(false)}
                >
                  <X size={18} color={tokens.mutedForeground} />
                </Pressable>
              </View>
              <Pressable
                accessibilityRole="button"
                style={[styles.settingsButton, { borderColor: tokens.border }]}
                onPress={() => navigate("/drawer/settings")}
              >
                <Settings size={15} color={tokens.mutedForeground} />
                <Text style={[typography.small, { color: tokens.foreground }]}>
                  {t.nav.settings}
                </Text>
              </Pressable>
            </View>
            <ScrollView
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.popoverContent}
            >
              {selectorContent}
            </ScrollView>
            {refreshWorkspaces ? (
              <View style={[styles.popoverFooter, { borderColor: tokens.border }]}>
                <NativeActionBar>{refreshWorkspaces}</NativeActionBar>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {presentation === "sheet" ? (
        <NativeBottomSheet
          visible={open}
          title={t.nav.workspace}
          showCloseButton
          onClose={() => setOpen(false)}
          footer={
            refreshWorkspaces ? <NativeActionBar>{refreshWorkspaces}</NativeActionBar> : undefined
          }
        >
          {selectorContent}
        </NativeBottomSheet>
      ) : null}

      <InstallFromGithubSheet
        visible={installOpen}
        onClose={() => setInstallOpen(false)}
        // The sheet has already invalidated the workspace queries by the time it
        // offers this, so the Inbox lands on the freshly created requests.
        onReviewChangeRequests={() => {
          setInstallOpen(false);
          router.replace("/drawer/inbox");
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  popoverRoot: { position: "relative", zIndex: 20 },
  button: {
    minHeight: mobile.minTouchTarget,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sidebarButton: {
    minHeight: 58,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  compactButton: {
    minHeight: 36,
    maxWidth: 180,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  buttonText: { flex: 1, minWidth: 0 },
  workspaceLogo: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  workspaceLogoLarge: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  planBadge: {
    alignSelf: "flex-start",
    marginTop: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  popover: {
    position: "absolute",
    top: 62,
    left: 0,
    right: 0,
    zIndex: 30,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  popoverHeader: {
    padding: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  popoverIdentity: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  settingsButton: {
    minHeight: 36,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  popoverContent: { paddingBottom: 10 },
  inlineErrorWrap: { marginHorizontal: 20, marginTop: 10 },
  popoverFooter: {
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
