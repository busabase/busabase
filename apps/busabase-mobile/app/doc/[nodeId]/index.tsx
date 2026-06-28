import { useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { Platform, ScrollView, StyleSheet, Text } from "react-native";
import { type DocVO, getDocRest } from "~/api/docs-rest";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { useConnection } from "~/connection/connection-store";
import { useNativeQuery } from "~/hooks/use-native-query";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

function DocDetailContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const tokens = useTokens();
  const { state } = useConnection();
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;

  const loadDoc = useCallback(
    () =>
      serverUrl && nodeId
        ? getDocRest(serverUrl, nodeId)
        : (Promise.resolve(null) as Promise<null>),
    [serverUrl, nodeId],
  );
  const docQuery = useNativeQuery<DocVO | null>(!!serverUrl && !!nodeId, loadDoc);
  const doc = docQuery.data ?? null;

  return (
    <DrawerScaffold subtitle="Doc" title={doc?.node.name ?? "Doc"}>
      {docQuery.loading ? <NativeLoadingState label="Loading doc" /> : null}
      {docQuery.error ? (
        <NativeErrorState message={docQuery.error} onRetry={docQuery.refetch} />
      ) : null}
      {!docQuery.loading && !docQuery.error && !doc ? (
        <NativeEmptyState description="This doc is not available." title="Doc not found" />
      ) : null}

      {doc ? (
        <ScrollView contentContainerStyle={styles.content}>
          {doc.node.description ? (
            <Text style={[typography.body, styles.block, { color: tokens.mutedForeground }]}>
              {doc.node.description}
            </Text>
          ) : null}
          <Text selectable style={[styles.code, { color: tokens.foreground }]}>
            {doc.body}
          </Text>
        </ScrollView>
      ) : null}
    </DrawerScaffold>
  );
}

export default function DocDetailScreen() {
  return (
    <ConnectionGuard>
      <DocDetailContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12 },
  block: { marginBottom: 4 },
  code: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 13,
    lineHeight: 19,
  },
});
