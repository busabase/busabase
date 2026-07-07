import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthInfo } from "busabase-contract/contract/schemas";
import { Check, ChevronDown, RefreshCw } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useConnection } from "~/connection/connection-store";
import type { BusabaseSpace } from "~/connection/types";
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

interface SpaceSelectorProps {
  compact?: boolean;
}

export function SpaceSelector({ compact = false }: SpaceSelectorProps) {
  const tokens = useTokens();
  const queryClient = useQueryClient();
  const { getCloudAuthorizationHeaders, selectSpace, state } = useConnection();
  const [open, setOpen] = useState(false);
  const connection = state.status === "connected" ? state.connection : null;
  const selectedSpace = connection?.selectedSpace ?? null;

  const authQuery = useQuery({
    queryKey: ["space-selector", connection?.serverUrl],
    enabled: connection?.mode === "cloud",
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

  const authInfo = authQuery.data as AuthInfo | undefined;
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
  const canSelect = connection?.mode === "cloud" && spaces.length > 0;

  const handleSelect = async (space: BusabaseSpace) => {
    await selectSpace(space);
    queryClient.clear();
    setOpen(false);
  };

  if (connection?.mode !== "cloud") {
    return compact ? null : (
      <View style={[styles.staticRow, { backgroundColor: tokens.primaryMuted }]}>
        <Text numberOfLines={1} style={[typography.small, { color: tokens.mutedForeground }]}>
          {connection?.mode === "demo" ? "Demo workspace" : "Self-hosted workspace"}
        </Text>
      </View>
    );
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Select workspace"
        disabled={!canSelect}
        style={[
          compact ? styles.compactButton : styles.button,
          {
            backgroundColor: tokens.primaryMuted,
            opacity: canSelect ? 1 : 0.72,
          },
        ]}
        onPress={() => setOpen(true)}
      >
        <View style={styles.buttonText}>
          <Text
            numberOfLines={1}
            style={[compact ? typography.small : typography.bodyEm, { color: tokens.foreground }]}
          >
            {activeSpace?.name ?? (authQuery.isLoading ? "Loading workspace" : "Workspace")}
          </Text>
          {!compact ? (
            <Text numberOfLines={1} style={[typography.small, { color: tokens.mutedForeground }]}>
              {spaces.length > 1
                ? `${spaces.length} workspaces`
                : activeSpace?.slug
                  ? `@${activeSpace.slug}`
                  : "Busabase Cloud"}
            </Text>
          ) : null}
        </View>
        {authQuery.isFetching ? (
          <RefreshCw size={16} color={tokens.mutedForeground} />
        ) : (
          <ChevronDown size={18} color={tokens.mutedForeground} />
        )}
      </Pressable>

      <NativeBottomSheet
        visible={open}
        title="Workspaces"
        showCloseButton
        onClose={() => setOpen(false)}
        footer={
          <NativeActionBar>
            <Button
              label={authQuery.isFetching ? "Refreshing..." : "Refresh workspaces"}
              variant="secondary"
              loading={authQuery.isFetching}
              fullWidth
              leadingIcon={<RefreshCw size={18} color={tokens.foreground} />}
              onPress={() => void authQuery.refetch()}
            />
          </NativeActionBar>
        }
      >
        {authQuery.error ? (
          <NativeInlineError
            message="Could not load workspaces."
            onReset={() => void authQuery.refetch()}
          />
        ) : null}
        <NativeSection
          title="Available"
          caption={spaces.length > 0 ? `${spaces.length}` : undefined}
        >
          {spaces.length === 0 ? (
            <NativeRow
              title={authQuery.isLoading ? "Loading workspaces" : "No workspaces"}
              subtitle={
                authQuery.isLoading
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
      </NativeBottomSheet>
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
  staticRow: {
    minHeight: 36,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    justifyContent: "center",
  },
});
