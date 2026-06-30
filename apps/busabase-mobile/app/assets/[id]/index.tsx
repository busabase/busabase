import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssetUsageVO } from "busabase-contract/domains/assets/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, ChevronRight, FileText } from "lucide-react-native";
import { Alert, Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeScreen,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useConnection } from "~/connection/connection-store";
import { useI18n } from "~/i18n";
import { isImageRef, resolveAttachmentUrl } from "~/lib/attachment";
import { formatBytes, shortId } from "~/lib/format";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

function AssetDetailContent() {
  const params = useLocalSearchParams<{ id?: string }>();
  const assetId = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const { state } = useConnection();
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;

  const detailQuery = useQuery(
    buda && assetId
      ? buda.orpc.assets.get.queryOptions({ input: { assetId } })
      : { queryKey: ["no-connection", "asset", assetId], queryFn: skipToken },
  );

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!buda) throw new Error("Not connected");
      return buda.client.assets.delete({ assetId });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: buda?.orpc.assets.list.key({}) });
      router.back();
    },
  });

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/drawer/assets"));

  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={mobile.hitSlop}
      style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={goBack}
    >
      <ArrowLeft size={22} color={tokens.foreground} />
    </Pressable>
  );

  if (detailQuery.isLoading) {
    return (
      <NativeScreen title={t.assets.title} headerLeading={headerLeading}>
        <NativeLoadingState label={t.common.loading} />
      </NativeScreen>
    );
  }
  if (detailQuery.error || !detailQuery.data) {
    return (
      <NativeScreen title={t.assets.title} headerLeading={headerLeading}>
        {detailQuery.error ? (
          <NativeErrorState
            message={detailQuery.error.message}
            onRetry={() => void detailQuery.refetch()}
          />
        ) : (
          <NativeEmptyState title={t.assets.notFound} description={t.assets.notFound} />
        )}
      </NativeScreen>
    );
  }

  const { asset, usages } = detailQuery.data;
  const url = resolveAttachmentUrl(serverUrl, asset.url);

  const openUsage = (usage: AssetUsageVO) => {
    if (usage.recordId) {
      router.push({ pathname: "/records/[id]", params: { id: usage.recordId } });
      return;
    }
    if (usage.nodeType === "base") {
      router.push({ pathname: "/base/[slug]", params: { slug: usage.nodeSlug } });
      return;
    }
    if (usage.nodeType === "doc") {
      router.push({ pathname: "/doc/[nodeId]", params: { nodeId: usage.nodeId } });
      return;
    }
    if (usage.nodeType === "skill") {
      router.push({ pathname: "/skill/[nodeId]", params: { nodeId: usage.nodeId } });
      return;
    }
    router.push({ pathname: "/folder/[nodeId]", params: { nodeId: usage.nodeId } });
  };

  const confirmDelete = () => {
    Alert.alert(t.assets.deleteTitle, t.assets.deleteConfirm, [
      { text: t.common.cancel, style: "cancel" },
      {
        text: t.common.deleteForever,
        style: "destructive",
        onPress: () => deleteMutation.mutate(),
      },
    ]);
  };

  return (
    <NativeScreen title={asset.name} subtitle={asset.fileName} headerLeading={headerLeading}>
      <View style={styles.content}>
        <View
          style={[styles.preview, { backgroundColor: tokens.muted, borderColor: tokens.border }]}
        >
          {isImageRef(asset) ? (
            <Image source={{ uri: url }} resizeMode="contain" style={styles.previewImage} />
          ) : (
            <Pressable
              accessibilityRole="button"
              style={styles.previewFile}
              onPress={() => void Linking.openURL(url).catch(() => undefined)}
            >
              <FileText size={36} color={tokens.mutedForeground} />
              <Text style={[typography.small, { color: tokens.primary }]}>{t.common.close}</Text>
            </Pressable>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <MetaRow label={t.assets.type} value={asset.mimeType} />
          <MetaRow label={t.assets.size} value={formatBytes(asset.size)} />
          {asset.contentHash ? (
            <MetaRow label={t.assets.contentHash} value={shortId(asset.contentHash)} />
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[typography.h2, { color: tokens.foreground }]}>{t.assets.whereUsed}</Text>
          {usages.length === 0 ? (
            <Text style={[typography.small, { color: tokens.mutedForeground }]}>
              {t.assets.notUsed}
            </Text>
          ) : (
            usages.map((usage) => (
              <Pressable
                key={`${usage.nodeId}-${usage.recordId ?? "node"}-${usage.fieldSlug ?? "all"}`}
                accessibilityRole="button"
                style={[styles.usageRow, { borderColor: tokens.border }]}
                onPress={() => openUsage(usage)}
              >
                <View style={styles.usageText}>
                  <Text numberOfLines={1} style={[typography.bodyEm, { color: tokens.foreground }]}>
                    {usage.nodeName}
                  </Text>
                  <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                    {usage.fieldSlug ? `${usage.nodeType} · ${usage.fieldSlug}` : usage.nodeType}
                  </Text>
                </View>
                <ChevronRight size={18} color={tokens.mutedForeground} />
              </Pressable>
            ))
          )}
        </View>

        {deleteMutation.error ? (
          <Text style={[typography.small, styles.error, { color: tokens.destructive }]}>
            {deleteMutation.error.message}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button
            label={usages.length > 0 ? t.assets.deleteBlocked : t.common.deleteForever}
            variant="destructive"
            disabled={usages.length > 0}
            loading={deleteMutation.isPending}
            fullWidth
            onPress={confirmDelete}
          />
        </View>
      </View>
    </NativeScreen>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  const tokens = useTokens();
  return (
    <View style={styles.metaRow}>
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>{label}</Text>
      <Text style={[typography.small, styles.metaValue, { color: tokens.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

export default function AssetDetailScreen() {
  return (
    <ConnectionGuard>
      <AssetDetailContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { marginHorizontal: 20, gap: 14 },
  preview: {
    height: 220,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: { width: "100%", height: "100%" },
  previewFile: { alignItems: "center", gap: 8 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: 16,
    gap: 12,
  },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  metaValue: { flexShrink: 1, textAlign: "right" },
  usageRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
  },
  usageText: { flex: 1, gap: 2 },
  actions: { marginTop: 4 },
  error: { textAlign: "center" },
});
