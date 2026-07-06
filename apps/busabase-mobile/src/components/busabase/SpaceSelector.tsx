import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthInfo } from "busabase-contract/contract/schemas";
import { Check, ChevronDown, RefreshCw } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useConnection } from "~/connection/connection-store";
import type { BusabaseSpace } from "~/connection/types";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

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

      <Modal animationType="fade" transparent visible={open} onRequestClose={() => setOpen(false)}>
        <View style={styles.modal}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
          <View
            style={[styles.sheet, { backgroundColor: tokens.surface, borderColor: tokens.border }]}
          >
            <View style={styles.sheetHeader}>
              <Text style={[typography.h2, { color: tokens.foreground }]}>Workspaces</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh workspaces"
                hitSlop={mobile.hitSlop}
                onPress={() => void authQuery.refetch()}
              >
                <RefreshCw size={18} color={tokens.mutedForeground} />
              </Pressable>
            </View>
            {authQuery.error ? (
              <Text style={[typography.small, styles.hint, { color: tokens.destructive }]}>
                Could not load workspaces.
              </Text>
            ) : null}
            {spaces.map((space) => {
              const active = activeSpace?.id === space.id;
              return (
                <Pressable
                  key={space.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.spaceRow,
                    {
                      backgroundColor: active ? tokens.primaryMuted : "transparent",
                      borderColor: tokens.border,
                    },
                  ]}
                  onPress={() => void handleSelect(space)}
                >
                  <View style={styles.spaceText}>
                    <Text
                      numberOfLines={1}
                      style={[typography.bodyEm, { color: tokens.foreground }]}
                    >
                      {space.name}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[typography.small, { color: tokens.mutedForeground }]}
                    >
                      {[space.slug ? `@${space.slug}` : null, space.plan]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                  {active ? <Check size={18} color={tokens.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
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
  modal: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.28)" },
  sheet: {
    margin: 12,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  sheetHeader: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  hint: { paddingHorizontal: 4 },
  spaceRow: {
    minHeight: mobile.minTouchTarget,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  spaceText: { flex: 1, minWidth: 0 },
});
