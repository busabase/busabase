import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthInfo } from "busabase-contract/contract/schemas";
import { usePathname, useRouter } from "expo-router";
import { Check, ChevronDown, RefreshCw } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useConnection } from "~/connection/connection-store";
import type { BusabaseSpace } from "~/connection/types";
import { useI18n } from "~/i18n";
import { DRAWER_DESTINATIONS, isDrawerAction, isDrawerItemActive } from "~/lib/nav-destinations";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeInlineError,
  NativeRow,
  NativeSection,
} from "../native-screen";
import { Button } from "../ui/Button";
import { InstallFromGithubSheet } from "./InstallFromGithubSheet";

interface SpaceSelectorProps {
  compact?: boolean;
}

/**
 * The Space Selector sheet, mirroring the web dashboard's: it holds BOTH the
 * top-level destinations (Inbox · Activity · Archived · Assets · Records ·
 * Bases · Graph View) and — on Busabase Cloud — the workspace switcher.
 *
 * The trigger and the sheet render in EVERY connection mode. Only the
 * "Available workspaces" list and its refresh footer are cloud-only; self-hosted
 * and demo connections have exactly one workspace, so they get its name as a
 * static line instead. Gating the whole component on `mode === "cloud"` (as it
 * used to) would now leave those users with no way to reach any destination.
 */
export function SpaceSelector({ compact = false }: SpaceSelectorProps) {
  const tokens = useTokens();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { getCloudAuthorizationHeaders, selectSpace, state } = useConnection();
  const [open, setOpen] = useState(false);
  // Opened FROM this sheet, but rendered as its sibling: two RN `Modal`s must
  // not be on screen at once, so the selector closes as the install sheet opens.
  const [installOpen, setInstallOpen] = useState(false);
  const connection = state.status === "connected" ? state.connection : null;
  const selectedSpace = connection?.selectedSpace ?? null;
  const isCloud = connection?.mode === "cloud";

  const authQuery = useQuery({
    queryKey: ["space-selector", connection?.serverUrl],
    // Never fires outside Busabase Cloud: /api/v1/auth's space list is a
    // cloud-only concept, and a self-hosted server would just 404.
    enabled: isCloud,
    queryFn: async () => {
      if (!connection?.serverUrl) {
        throw new Error("No Busabase Cloud connection");
      }
      const response = await fetch(`${connection.serverUrl.replace(/\/+$/, "")}/api/v1/auth`, {
        headers: {
          Accept: "application/json",
          ...(await getCloudAuthorizationHeaders({ spaceId: null })),
        },
      });
      if (!response.ok) {
        throw new Error(`Server responded ${response.status}`);
      }
      return (await response.json()) as AuthInfo;
    },
  });

  const authInfo = isCloud ? (authQuery.data as AuthInfo | undefined) : undefined;
  const spaces = authInfo?.spaces ?? [];
  const activeSpace =
    selectedSpace ??
    (authInfo?.space
      ? {
          id: authInfo.space.id,
          name: authInfo.space.name,
          slug: authInfo.space.slug,
          plan: authInfo.space.plan,
        }
      : null);
  const isLoadingSpaces = isCloud && authQuery.isLoading;
  const isFetchingSpaces = isCloud && authQuery.isFetching;

  const staticWorkspaceName =
    connection?.mode === "demo" ? "Demo workspace" : "Self-hosted workspace";
  const triggerTitle = isCloud
    ? (activeSpace?.name ?? (isLoadingSpaces ? "Loading workspace" : t.nav.workspace))
    : (activeSpace?.name ?? staticWorkspaceName);
  const triggerSubtitle = isCloud
    ? spaces.length > 1
      ? `${spaces.length} ${t.nav.workspaces}`
      : activeSpace?.slug
        ? `@${activeSpace.slug}`
        : "Busabase Cloud"
    : (connection?.serverUrl ?? staticWorkspaceName);

  const handleSelect = async (space: BusabaseSpace) => {
    await selectSpace(space);
    queryClient.clear();
    setOpen(false);
  };

  const navigate = (href: string) => {
    setOpen(false);
    router.replace(href as never);
  };

  const openInstallSheet = () => {
    setOpen(false);
    setInstallOpen(true);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.nav.workspace}
        style={[
          compact ? styles.compactButton : styles.button,
          { backgroundColor: tokens.primaryMuted },
        ]}
        onPress={() => setOpen(true)}
      >
        <View style={styles.buttonText}>
          <Text
            numberOfLines={1}
            style={[compact ? typography.small : typography.bodyEm, { color: tokens.foreground }]}
          >
            {triggerTitle}
          </Text>
          {compact ? null : (
            <Text numberOfLines={1} style={[typography.small, { color: tokens.mutedForeground }]}>
              {triggerSubtitle}
            </Text>
          )}
        </View>
        {isFetchingSpaces ? (
          <RefreshCw size={16} color={tokens.mutedForeground} />
        ) : (
          <ChevronDown size={18} color={tokens.mutedForeground} />
        )}
      </Pressable>

      <NativeBottomSheet
        visible={open}
        title={t.nav.workspace}
        showCloseButton
        onClose={() => setOpen(false)}
        footer={
          isCloud ? (
            <NativeActionBar>
              <Button
                label={isFetchingSpaces ? "Refreshing..." : "Refresh workspaces"}
                variant="secondary"
                loading={isFetchingSpaces}
                fullWidth
                leadingIcon={<RefreshCw size={18} color={tokens.foreground} />}
                onPress={() => void authQuery.refetch()}
              />
            </NativeActionBar>
          ) : undefined
        }
      >
        <NativeSection title={t.nav.goTo}>
          {DRAWER_DESTINATIONS.map((destination, index) => {
            const active = isDrawerItemActive(pathname, destination);
            const Icon = destination.icon;
            return (
              <NativeRow
                key={destination.key}
                title={t.nav[destination.key]}
                leading={
                  <Icon size={18} color={active ? tokens.primary : tokens.mutedForeground} />
                }
                trailing={active ? <Check size={18} color={tokens.primary} /> : undefined}
                last={index === DRAWER_DESTINATIONS.length - 1}
                onPress={() =>
                  isDrawerAction(destination) ? openInstallSheet() : navigate(destination.href)
                }
              />
            );
          })}
        </NativeSection>

        {isCloud ? (
          <>
            {authQuery.error ? (
              <NativeInlineError
                message="Could not load workspaces."
                onReset={() => void authQuery.refetch()}
              />
            ) : null}
            <NativeSection
              title={t.nav.workspaces}
              caption={spaces.length > 0 ? `${spaces.length}` : undefined}
            >
              {spaces.length === 0 ? (
                <NativeRow
                  title={isLoadingSpaces ? "Loading workspaces" : "No workspaces"}
                  subtitle={
                    isLoadingSpaces
                      ? "Fetching available Busabase Cloud spaces."
                      : "Refresh or reconnect to Busabase Cloud."
                  }
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
            <NativeRow title={triggerTitle} subtitle={connection?.serverUrl} last />
          </NativeSection>
        )}
      </NativeBottomSheet>

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
  button: {
    minHeight: mobile.minTouchTarget,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
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
});
