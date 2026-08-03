import { skipToken, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { FileText } from "lucide-react-native";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeSection,
} from "~/components/native-screen";
import { useConnection } from "~/connection/connection-store";
import { getAttachmentKindLabel, isImageRef, resolveAttachmentUrl } from "~/lib/attachment";
import { formatBytes } from "~/lib/format";
import { asNodeDetail } from "~/lib/node-detail";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

function FileNodeContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const buda = useBusabaseOrpc();
  const tokens = useTokens();
  const { state } = useConnection();
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;
  const fileQuery = useQuery(
    buda && nodeId
      ? buda.orpc.nodes.get.queryOptions({ input: { nodeId, type: "file" } })
      : { queryKey: ["no-connection", "file", nodeId], queryFn: skipToken },
  );
  // `nodes.get` answers for every node type, so narrow before reading `.asset`.
  const file = asNodeDetail(fileQuery.data, "file");
  const asset = file?.asset;
  const notFound = !fileQuery.isLoading && !fileQuery.error && !file;
  const assetUrl = asset ? resolveAttachmentUrl(serverUrl, asset.url) : "";

  return (
    <DrawerScaffold
      title={file?.node.name ?? "File"}
      titleNumberOfLines={2}
      subtitle={asset ? `${getAttachmentKindLabel(asset)} · ${formatBytes(asset.size)}` : undefined}
      refreshing={fileQuery.isRefetching}
      onRefresh={() => void fileQuery.refetch()}
    >
      {fileQuery.isLoading ? <NativeLoadingState label="Loading file" /> : null}
      {fileQuery.error ? (
        <NativeErrorState
          message={fileQuery.error.message}
          onRetry={() => void fileQuery.refetch()}
        />
      ) : null}
      {notFound ? (
        <NativeEmptyState description="This file is not available." title="File not found" />
      ) : null}
      {asset ? (
        <NativeSection title="Preview" caption={asset.fileName}>
          <View
            style={[
              styles.preview,
              isImageRef(asset) ? styles.imagePreview : styles.filePreview,
              { backgroundColor: tokens.muted },
            ]}
          >
            {isImageRef(asset) ? (
              <Image source={{ uri: assetUrl }} resizeMode="contain" style={styles.previewImage} />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${asset.fileName}`}
                style={styles.previewFile}
                onPress={() => void Linking.openURL(assetUrl).catch(() => undefined)}
              >
                <FileText size={36} color={tokens.mutedForeground} />
                <Text style={[typography.small, { color: tokens.primary }]}>Open</Text>
              </Pressable>
            )}
          </View>
        </NativeSection>
      ) : null}
    </DrawerScaffold>
  );
}

const styles = StyleSheet.create({
  preview: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  imagePreview: { height: 220 },
  filePreview: { minHeight: 112 },
  previewImage: { width: "100%", height: "100%" },
  previewFile: { alignItems: "center", gap: 8 },
});

export default function FileNodeScreen() {
  return (
    <ConnectionGuard>
      <FileNodeContent />
    </ConnectionGuard>
  );
}
