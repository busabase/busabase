import { skipToken, useQuery } from "@tanstack/react-query";
import type { AssetVO } from "busabase-contract/domains/assets/types";
import { useRouter } from "expo-router";
import { FileText } from "lucide-react-native";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { useConnection } from "~/connection/connection-store";
import { fmt, useI18n } from "~/i18n";
import { isImageRef, resolveAttachmentUrl } from "~/lib/attachment";
import { formatBytes } from "~/lib/format";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

function AssetsContent() {
  const router = useRouter();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const { state } = useConnection();
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;

  const assetsQuery = useQuery(
    buda
      ? buda.orpc.assets.list.queryOptions({})
      : { queryKey: ["no-connection", "assets"], queryFn: skipToken },
  );

  const assets = assetsQuery.data ?? [];

  return (
    <DrawerScaffold
      title={t.assets.title}
      subtitle={t.assets.subtitle}
      refreshing={assetsQuery.isRefetching}
      onRefresh={() => void assetsQuery.refetch()}
    >
      {assetsQuery.isLoading ? <NativeLoadingState label={t.common.loading} /> : null}
      {assetsQuery.error ? (
        <NativeErrorState
          message={assetsQuery.error.message}
          onRetry={() => void assetsQuery.refetch()}
        />
      ) : null}
      {!assetsQuery.isLoading && !assetsQuery.error && assets.length === 0 ? (
        <NativeEmptyState title={t.assets.empty} description={t.assets.emptyHint} />
      ) : null}

      <View style={styles.grid}>
        {assets.map((asset) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            serverUrl={serverUrl}
            onPress={() => router.push({ pathname: "/assets/[id]", params: { id: asset.id } })}
          />
        ))}
      </View>
    </DrawerScaffold>
  );
}

function AssetCard({
  asset,
  serverUrl,
  onPress,
}: {
  asset: AssetVO;
  serverUrl: string | null;
  onPress: () => void;
}) {
  const tokens = useTokens();
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${asset.name}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: tokens.card, borderColor: tokens.border, opacity: pressed ? 0.8 : 1 },
      ]}
      onPress={onPress}
    >
      <View style={[styles.thumb, { backgroundColor: tokens.muted }]}>
        {isImageRef(asset) ? (
          <Image
            source={{ uri: resolveAttachmentUrl(serverUrl, asset.url) }}
            resizeMode="cover"
            style={styles.thumbImage}
          />
        ) : (
          <FileText size={26} color={tokens.mutedForeground} />
        )}
        {asset.usageCount > 0 ? (
          <View style={[styles.badge, { backgroundColor: tokens.primary }]}>
            <Text style={[typography.caption, { color: tokens.primaryForeground }]}>
              {asset.usageCount}
            </Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={[typography.small, { color: tokens.foreground }]}>
        {asset.name}
      </Text>
      <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
        {asset.usageCount > 0
          ? fmt(t.assets.usedTimes, { count: asset.usageCount })
          : `${t.assets.unused} · ${formatBytes(asset.size)}`}
      </Text>
    </Pressable>
  );
}

export default function AssetsScreen() {
  return (
    <ConnectionGuard>
      <AssetsContent />
    </ConnectionGuard>
  );
}

const CARD_BASIS = "47%";

const styles = StyleSheet.create({
  grid: {
    marginHorizontal: 20,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  card: {
    flexBasis: CARD_BASIS,
    flexGrow: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: 10,
    gap: 6,
  },
  thumb: {
    height: 104,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbImage: { width: "100%", height: "100%" },
  badge: {
    position: "absolute",
    top: 6,
    right: 6,
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.full,
    alignItems: "center",
  },
});
