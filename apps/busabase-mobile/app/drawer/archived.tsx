import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BaseVO, NodeVO } from "busabase-contract/types";
import { useRouter } from "expo-router";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { fmt, useI18n } from "~/i18n";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const SUBMITTED_BY = "mobile-editor";

function ArchivedContent() {
  const router = useRouter();
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();

  const basesQuery = useQuery(
    buda
      ? buda.orpc.bases.listArchived.queryOptions({})
      : { queryKey: ["no-connection", "archived-bases"], queryFn: skipToken },
  );
  const nodesQuery = useQuery(
    buda
      ? buda.orpc.nodes.listArchived.queryOptions({})
      : { queryKey: ["no-connection", "archived-nodes"], queryFn: skipToken },
  );

  const refresh = () => {
    void basesQuery.refetch();
    void nodesQuery.refetch();
  };

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: buda?.orpc.bases.listArchived.key({}) });
    void queryClient.invalidateQueries({ queryKey: buda?.orpc.nodes.listArchived.key({}) });
  };

  const restoreBase = useMutation({
    mutationFn: async (base: BaseVO) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.bases.restoreChangeRequest({ baseId: base.id, submittedBy: SUBMITTED_BY });
    },
    onSuccess: (changeRequest) =>
      router.push({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } }),
  });

  const restoreNode = useMutation({
    mutationFn: async (node: NodeVO) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.nodes.createChangeRequest({
        message: `Restore ${node.name}`,
        operations: [{ kind: "restore", nodeId: node.id }],
      });
    },
    onSuccess: (changeRequest) =>
      router.push({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } }),
  });

  const purge = useMutation({
    mutationFn: async (nodeId: string) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.nodes.purge({ nodeId });
    },
    onSuccess: invalidate,
  });

  const confirmRestore = (name: string, onConfirm: () => void) =>
    Alert.alert(t.common.restore, fmt(t.archived.restoreConfirm, { name }), [
      { text: t.common.cancel, style: "cancel" },
      { text: t.common.restore, onPress: onConfirm },
    ]);

  const confirmPurge = (name: string, nodeId: string) =>
    Alert.alert(t.archived.purgeTitle, fmt(t.archived.purgeConfirm, { name }), [
      { text: t.common.cancel, style: "cancel" },
      { text: t.common.deleteForever, style: "destructive", onPress: () => purge.mutate(nodeId) },
    ]);

  const archivedBases = basesQuery.data ?? [];
  const archivedNodes = nodesQuery.data ?? [];
  const isLoading = basesQuery.isLoading || nodesQuery.isLoading;
  const error = basesQuery.error ?? nodesQuery.error ?? purge.error;
  const isEmpty = !isLoading && archivedBases.length === 0 && archivedNodes.length === 0;

  return (
    <DrawerScaffold
      title={t.archived.title}
      subtitle={t.archived.subtitle}
      refreshing={basesQuery.isRefetching || nodesQuery.isRefetching}
      onRefresh={refresh}
    >
      {isLoading ? <NativeLoadingState label={t.common.loading} /> : null}
      {error ? <NativeErrorState message={error.message} onRetry={refresh} /> : null}
      {isEmpty ? (
        <NativeEmptyState title={t.archived.empty} description={t.archived.emptyHint} />
      ) : null}

      {archivedBases.length > 0 ? (
        <View style={styles.section}>
          <Text
            style={[typography.caption, styles.sectionLabel, { color: tokens.mutedForeground }]}
          >
            {t.archived.basesSection}
          </Text>
          {archivedBases.map((base) => (
            <ArchivedRow
              key={base.id}
              name={base.name}
              meta={base.slug}
              restoring={restoreBase.isPending}
              purging={purge.isPending}
              onRestore={() => confirmRestore(base.name, () => restoreBase.mutate(base))}
              onPurge={() => confirmPurge(base.name, base.nodeId)}
            />
          ))}
        </View>
      ) : null}

      {archivedNodes.length > 0 ? (
        <View style={styles.section}>
          <Text
            style={[typography.caption, styles.sectionLabel, { color: tokens.mutedForeground }]}
          >
            {t.archived.nodesSection}
          </Text>
          {archivedNodes.map((node) => (
            <ArchivedRow
              key={node.id}
              name={node.name}
              meta={`${node.type} · ${node.slug}`}
              restoring={restoreNode.isPending}
              purging={purge.isPending}
              onRestore={() => confirmRestore(node.name, () => restoreNode.mutate(node))}
              onPurge={() => confirmPurge(node.name, node.id)}
            />
          ))}
        </View>
      ) : null}
    </DrawerScaffold>
  );
}

function ArchivedRow({
  name,
  meta,
  restoring,
  purging,
  onRestore,
  onPurge,
}: {
  name: string;
  meta: string;
  restoring: boolean;
  purging: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const tokens = useTokens();
  const { t } = useI18n();
  return (
    <View style={[styles.row, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[typography.bodyEm, { color: tokens.foreground }]}>
          {name}
        </Text>
        <Text numberOfLines={1} style={[typography.caption, { color: tokens.mutedForeground }]}>
          {meta}
        </Text>
      </View>
      <View style={styles.rowActions}>
        <Button
          label={t.common.restore}
          variant="secondary"
          loading={restoring}
          onPress={onRestore}
        />
        <Button
          label={t.common.deleteForever}
          variant="ghost"
          loading={purging}
          onPress={onPurge}
        />
      </View>
    </View>
  );
}

export default function ArchivedScreen() {
  return (
    <ConnectionGuard>
      <ArchivedContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  section: { marginHorizontal: 20, marginTop: 8, gap: 10 },
  sectionLabel: { textTransform: "uppercase" },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: 14,
    gap: 12,
  },
  rowText: { gap: 2 },
  rowActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
