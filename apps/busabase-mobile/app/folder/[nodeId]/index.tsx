import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { type FolderVO, getFolderRest } from "~/api/folders-rest";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { useConnection } from "~/connection/connection-store";
import { useNativeQuery } from "~/hooks/use-native-query";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

type FolderChild = FolderVO["children"][number];

function FolderDetailContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const tokens = useTokens();
  const router = useRouter();
  const { state } = useConnection();
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;

  const loadFolder = useCallback(
    () =>
      serverUrl && nodeId
        ? getFolderRest(serverUrl, nodeId)
        : (Promise.resolve(null) as Promise<null>),
    [serverUrl, nodeId],
  );
  const folderQuery = useNativeQuery<FolderVO | null>(!!serverUrl && !!nodeId, loadFolder);
  const folder = folderQuery.data ?? null;

  const openChild = (child: FolderChild) => {
    if (child.type === "base") {
      router.push({ pathname: "/base/[slug]", params: { slug: child.slug } });
    } else if (child.type === "skill") {
      router.push({ pathname: "/skill/[nodeId]", params: { nodeId: child.id } });
    } else if (child.type === "doc") {
      router.push({ pathname: "/doc/[nodeId]", params: { nodeId: child.id } });
    } else if (child.type === "folder") {
      router.push({ pathname: "/folder/[nodeId]", params: { nodeId: child.id } });
    }
  };

  return (
    <DrawerScaffold
      subtitle={folder ? `${folder.children.length} items` : "Folder"}
      title={folder?.node.name ?? "Folder"}
    >
      {folderQuery.loading ? <NativeLoadingState label="Loading folder" /> : null}
      {folderQuery.error ? (
        <NativeErrorState message={folderQuery.error} onRetry={folderQuery.refetch} />
      ) : null}
      {!folderQuery.loading && !folderQuery.error && !folder ? (
        <NativeEmptyState description="This folder is not available." title="Folder not found" />
      ) : null}

      {folder ? (
        <ScrollView contentContainerStyle={styles.content}>
          {folder.children.length === 0 ? (
            <NativeEmptyState description="This folder has no items yet." title="Empty folder" />
          ) : (
            folder.children.map((child) => (
              <Pressable
                accessibilityLabel={`Open ${child.name}`}
                accessibilityRole="button"
                key={child.id}
                onPress={() => openChild(child)}
                style={[styles.row, { backgroundColor: tokens.muted, borderColor: tokens.border }]}
              >
                <Text style={[typography.body, styles.rowTitle, { color: tokens.foreground }]}>
                  {child.name}
                </Text>
                <View style={[styles.badge, { borderColor: tokens.border }]}>
                  <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                    {child.type}
                  </Text>
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      ) : null}
    </DrawerScaffold>
  );
}

export default function FolderDetailScreen() {
  return (
    <ConnectionGuard>
      <FolderDetailContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
  },
  rowTitle: { flex: 1, minWidth: 0 },
  badge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});
