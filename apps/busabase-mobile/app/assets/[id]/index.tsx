import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getNodeType } from "busabase-contract/domains";
import type { AssetUsageVO } from "busabase-contract/domains/assets/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, FileText, MoreHorizontal, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeEmptyState,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
  NativeRow,
  NativeScreen,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useConnection } from "~/connection/connection-store";
import { useI18n } from "~/i18n";
import { getAttachmentKindLabel, isImageRef, resolveAttachmentUrl } from "~/lib/attachment";
import { formatBytes, shortId } from "~/lib/format";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const getUsageNodeLabel = (usage: AssetUsageVO) =>
  getNodeType(usage.nodeType)?.label ?? usage.nodeType;

function AssetDetailContent() {
  const params = useLocalSearchParams<{ id?: string }>();
  const assetId = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const { state } = useConnection();
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);
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
      setActionsSheetOpen(false);
      setDeleteSheetOpen(false);
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
  const assetKindLabel = getAttachmentKindLabel(asset);

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

  return (
    <NativeScreen
      title={asset.name}
      subtitle={asset.fileName}
      headerLeading={headerLeading}
      headerAction={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open asset actions"
          hitSlop={mobile.hitSlop}
          style={[styles.moreButton, { backgroundColor: tokens.primaryMuted }]}
          onPress={() => setActionsSheetOpen(true)}
        >
          <MoreHorizontal size={21} color={tokens.foreground} />
        </Pressable>
      }
    >
      <NativeSection title={t.assets.preview}>
        <View style={[styles.preview, { backgroundColor: tokens.muted }]}>
          {isImageRef(asset) ? (
            <Image source={{ uri: url }} resizeMode="contain" style={styles.previewImage} />
          ) : (
            <Pressable
              accessibilityRole="button"
              style={styles.previewFile}
              onPress={() => void Linking.openURL(url).catch(() => undefined)}
            >
              <FileText size={36} color={tokens.mutedForeground} />
              <Text style={[typography.small, { color: tokens.primary }]}>{t.common.open}</Text>
            </Pressable>
          )}
        </View>
      </NativeSection>

      <NativeSection title={t.assets.info}>
        <NativeRow title={t.assets.type} subtitle={assetKindLabel} meta={asset.mimeType} />
        <NativeRow
          title={t.assets.size}
          subtitle={formatBytes(asset.size)}
          last={!asset.contentHash}
        />
        {asset.contentHash ? (
          <NativeRow title={t.assets.contentHash} subtitle={shortId(asset.contentHash)} last />
        ) : null}
      </NativeSection>

      <NativeSection title={t.assets.whereUsed} caption={`${usages.length}`}>
        {usages.length === 0 ? (
          <NativeRow title={t.assets.notUsed} subtitle={asset.fileName} last />
        ) : (
          usages.map((usage, index) => (
            <NativeRow
              key={`${usage.nodeId}-${usage.recordId ?? "node"}-${usage.fieldSlug ?? "all"}`}
              title={usage.nodeName}
              subtitle={
                usage.fieldSlug
                  ? `${getUsageNodeLabel(usage)} · ${usage.fieldSlug}`
                  : getUsageNodeLabel(usage)
              }
              last={index === usages.length - 1}
              onPress={() => openUsage(usage)}
            />
          ))
        )}
      </NativeSection>

      <NativeBottomSheet
        visible={actionsSheetOpen}
        title={t.assets.actionsTitle}
        description={usages.length > 0 ? t.assets.deleteBlocked : t.assets.actionsHint}
        showCloseButton
        onClose={() => setActionsSheetOpen(false)}
        footer={
          <NativeActionBar>
            {deleteMutation.error ? (
              <NativeInlineError
                message={deleteMutation.error.message}
                onReset={() => deleteMutation.reset()}
              />
            ) : null}
            <Button
              label={t.common.deleteForever}
              variant="destructive"
              disabled={usages.length > 0}
              loading={deleteMutation.isPending}
              fullWidth
              leadingIcon={
                <Trash2
                  size={18}
                  color={usages.length > 0 ? tokens.mutedForeground : tokens.destructiveForeground}
                />
              }
              onPress={() => {
                setActionsSheetOpen(false);
                setDeleteSheetOpen(true);
              }}
            />
            <Button
              label={t.common.close}
              variant="ghost"
              disabled={deleteMutation.isPending}
              fullWidth
              onPress={() => setActionsSheetOpen(false)}
            />
          </NativeActionBar>
        }
      />

      <NativeBottomSheet
        visible={deleteSheetOpen}
        title={t.assets.deleteTitle}
        description={t.assets.deleteConfirm}
        showCloseButton
        onClose={() => setDeleteSheetOpen(false)}
        footer={
          <NativeActionBar>
            {deleteMutation.error ? (
              <NativeInlineError
                message={deleteMutation.error.message}
                onReset={() => deleteMutation.reset()}
              />
            ) : null}
            <Button
              label={t.common.deleteForever}
              variant="destructive"
              loading={deleteMutation.isPending}
              fullWidth
              onPress={() => deleteMutation.mutate()}
            />
            <Button
              label={t.common.cancel}
              variant="ghost"
              disabled={deleteMutation.isPending}
              fullWidth
              onPress={() => setDeleteSheetOpen(false)}
            />
          </NativeActionBar>
        }
      />
    </NativeScreen>
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
  moreButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  preview: {
    height: 220,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: { width: "100%", height: "100%" },
  previewFile: { alignItems: "center", gap: 8 },
});
