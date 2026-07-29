import { skipToken, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { FileText } from "lucide-react-native";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { NativeErrorState, NativeLoadingState, NativeSection } from "~/components/native-screen";
import { useConnection } from "~/connection/connection-store";
import { getAttachmentKindLabel, isImageRef, resolveAttachmentUrl } from "~/lib/attachment";
import { formatBytes } from "~/lib/format";
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
      ? buda.orpc.files.get.queryOptions({ input: { nodeId } })
      : { queryKey: ["no-connection", "file", nodeId], queryFn: skipToken },
  );
  const file = fileQuery.data;
  const asset = file?.asset;
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
      {asset ? (
        <NativeSection title="Preview" caption={asset.fileName}>
          <View style={[styles.preview, { backgroundColor: tokens.muted }]}>
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
    height: 220,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
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
