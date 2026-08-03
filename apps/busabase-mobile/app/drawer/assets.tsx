import { skipToken, useQuery } from "@tanstack/react-query";
import type { AssetVO } from "busabase-contract/domains/assets/types";
import { useRouter } from "expo-router";
import { FileText } from "lucide-react-native";
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import {
  NativeActionBar,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useConnection } from "~/connection/connection-store";
import { fmt, useI18n } from "~/i18n";
import { getAttachmentKindLabel, isImageRef, resolveAttachmentUrl } from "~/lib/attachment";
import { formatBytes } from "~/lib/format";
import { radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const ASSET_BATCH_SIZE = 50;

function AssetsContent() {
  const router = useRouter();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const { state } = useConnection();
  const [visibleCount, setVisibleCount] = useState(ASSET_BATCH_SIZE);
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;

  const assetsQuery = useQuery(
    buda
      ? buda.orpc.assets.list.queryOptions({})
      : { queryKey: ["no-connection", "assets"], queryFn: skipToken },
  );

  const assets = assetsQuery.data ?? [];
  const visibleAssets = assets.slice(0, visibleCount);

  return (
    <DrawerScaffold
      title={t.assets.title}
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

      {assets.length > 0 ? (
        <NativeSection>
          {visibleAssets.map((asset, index) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              serverUrl={serverUrl}
              last={index === visibleAssets.length - 1}
              onPress={() => router.push({ pathname: "/asset/[id]", params: { id: asset.id } })}
            />
          ))}
        </NativeSection>
      ) : null}
      {visibleCount < assets.length ? (
        <NativeActionBar>
          <Button
            label="Load more"
            variant="secondary"
            fullWidth
            onPress={() => setVisibleCount((count) => count + ASSET_BATCH_SIZE)}
          />
        </NativeActionBar>
      ) : null}
    </DrawerScaffold>
  );
}

function AssetRow({
  asset,
  serverUrl,
  last,
  onPress,
}: {
  asset: AssetVO;
  serverUrl: string | null;
  last: boolean;
  onPress: () => void;
}) {
  const tokens = useTokens();
  const { t } = useI18n();
  const usageLabel =
    asset.usageCount > 0 ? fmt(t.assets.usedTimes, { count: asset.usageCount }) : t.assets.unused;
  const kindLabel = getAttachmentKindLabel(asset);

  return (
    <NativeRow
      title={asset.name}
      subtitle={`${kindLabel} · ${formatBytes(asset.size)}`}
      meta={usageLabel}
      leading={
        <View style={[styles.thumb, { backgroundColor: tokens.muted }]}>
          {isImageRef(asset) ? (
            <Image
              source={{ uri: resolveAttachmentUrl(serverUrl, asset.url) }}
              resizeMode="cover"
              style={styles.thumbImage}
            />
          ) : (
            <FileText size={18} color={tokens.mutedForeground} />
          )}
        </View>
      }
      last={last}
      onPress={onPress}
    />
  );
}

export default function AssetsScreen() {
  return (
    <ConnectionGuard>
      <AssetsContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  thumb: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbImage: { width: "100%", height: "100%" },
});
