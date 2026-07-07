import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getNodeType } from "busabase-contract/domains";
import type { BaseVO, NodeVO } from "busabase-contract/types";
import { useRouter } from "expo-router";
import { ArchiveRestore, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeEmptyState,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { fmt, useI18n } from "~/i18n";
import { useTokens } from "~/theme/use-tokens";

const SUBMITTED_BY = "mobile-editor";

const getArchivedNodeMeta = (node: NodeVO) => {
  const label = getNodeType(node.type)?.label ?? node.type;
  return `${label} · ${node.slug}`;
};

type ArchivedAction =
  | { kind: "base"; name: string; meta: string; base: BaseVO }
  | { kind: "node"; name: string; meta: string; node: NodeVO };

type ArchivedConfirm = "restore" | "purge" | null;

function ArchivedContent() {
  const router = useRouter();
  const { t } = useI18n();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<ArchivedAction | null>(null);
  const [confirmAction, setConfirmAction] = useState<ArchivedConfirm>(null);

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
    onSuccess: (changeRequest) => {
      setPendingAction(null);
      setConfirmAction(null);
      router.push({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } });
    },
  });

  const restoreNode = useMutation({
    mutationFn: async (node: NodeVO) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.nodes.createChangeRequest({
        message: `Restore ${node.name}`,
        operations: [{ kind: "restore", nodeId: node.id }],
      });
    },
    onSuccess: (changeRequest) => {
      setPendingAction(null);
      setConfirmAction(null);
      router.push({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } });
    },
  });

  const purge = useMutation({
    mutationFn: async (nodeId: string) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.nodes.purge({ nodeId });
    },
    onSuccess: () => {
      setPendingAction(null);
      setConfirmAction(null);
      invalidate();
    },
  });

  const openActionSheet = (action: ArchivedAction) => {
    restoreBase.reset();
    restoreNode.reset();
    purge.reset();
    setConfirmAction(null);
    setPendingAction(action);
  };

  const archivedBases = basesQuery.data ?? [];
  const archivedNodes = nodesQuery.data ?? [];
  const isLoading = basesQuery.isLoading || nodesQuery.isLoading;
  const actionError = restoreBase.error ?? restoreNode.error ?? purge.error;
  const error = basesQuery.error ?? nodesQuery.error;
  const isEmpty = !isLoading && archivedBases.length === 0 && archivedNodes.length === 0;
  const actionPending = restoreBase.isPending || restoreNode.isPending || purge.isPending;

  const closeActionSheet = () => {
    if (actionPending) {
      return;
    }
    setPendingAction(null);
    setConfirmAction(null);
  };

  const restorePendingAction = () => {
    if (!pendingAction) {
      return;
    }
    if (pendingAction.kind === "base") {
      restoreBase.mutate(pendingAction.base);
      return;
    }
    restoreNode.mutate(pendingAction.node);
  };

  const purgePendingAction = () => {
    if (!pendingAction) {
      return;
    }
    purge.mutate(pendingAction.kind === "base" ? pendingAction.base.nodeId : pendingAction.node.id);
  };

  const actionTitle =
    confirmAction === "purge"
      ? t.archived.purgeTitle
      : confirmAction === "restore"
        ? t.common.restore
        : pendingAction?.name;
  const actionDescription =
    pendingAction && confirmAction
      ? confirmAction === "purge"
        ? fmt(t.archived.purgeConfirm, { name: pendingAction.name })
        : fmt(t.archived.restoreConfirm, { name: pendingAction.name })
      : pendingAction?.meta;

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
        <NativeSection title={t.archived.basesSection} caption={`${archivedBases.length}`}>
          {archivedBases.map((base, index) => (
            <ArchivedRow
              key={base.id}
              name={base.name}
              meta={base.slug}
              last={index === archivedBases.length - 1}
              disabled={actionPending}
              onPress={() =>
                openActionSheet({ kind: "base", name: base.name, meta: base.slug, base })
              }
            />
          ))}
        </NativeSection>
      ) : null}

      {archivedNodes.length > 0 ? (
        <NativeSection title={t.archived.nodesSection} caption={`${archivedNodes.length}`}>
          {archivedNodes.map((node, index) => (
            <ArchivedRow
              key={node.id}
              name={node.name}
              meta={getArchivedNodeMeta(node)}
              last={index === archivedNodes.length - 1}
              disabled={actionPending}
              onPress={() =>
                openActionSheet({
                  kind: "node",
                  name: node.name,
                  meta: getArchivedNodeMeta(node),
                  node,
                })
              }
            />
          ))}
        </NativeSection>
      ) : null}

      <NativeBottomSheet
        visible={!!pendingAction}
        title={actionTitle}
        description={actionDescription}
        showCloseButton
        onClose={closeActionSheet}
        footer={
          <NativeActionBar>
            {actionError ? (
              <NativeInlineError
                message={actionError.message}
                onReset={() => {
                  restoreBase.reset();
                  restoreNode.reset();
                  purge.reset();
                }}
              />
            ) : null}
            {confirmAction === "restore" ? (
              <Button
                label={t.common.restore}
                loading={actionPending}
                fullWidth
                leadingIcon={<ArchiveRestore size={18} color={tokens.primaryForeground} />}
                onPress={restorePendingAction}
              />
            ) : null}
            {confirmAction === "purge" ? (
              <Button
                label={t.common.deleteForever}
                variant="destructive"
                loading={actionPending}
                fullWidth
                leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
                onPress={purgePendingAction}
              />
            ) : null}
            {!confirmAction ? (
              <>
                <Button
                  label={t.common.restore}
                  fullWidth
                  leadingIcon={<ArchiveRestore size={18} color={tokens.primaryForeground} />}
                  onPress={() => setConfirmAction("restore")}
                />
                <Button
                  label={t.common.deleteForever}
                  variant="secondary"
                  fullWidth
                  leadingIcon={<Trash2 size={18} color={tokens.destructive} />}
                  onPress={() => setConfirmAction("purge")}
                />
              </>
            ) : null}
            <Button
              label={confirmAction ? t.common.cancel : t.common.close}
              variant="ghost"
              disabled={actionPending}
              fullWidth
              onPress={confirmAction ? () => setConfirmAction(null) : closeActionSheet}
            />
          </NativeActionBar>
        }
      />
    </DrawerScaffold>
  );
}

function ArchivedRow({
  name,
  meta,
  last,
  disabled,
  onPress,
}: {
  name: string;
  meta: string;
  last: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <NativeRow title={name} subtitle={meta} last={last} disabled={disabled} onPress={onPress} />
  );
}

export default function ArchivedScreen() {
  return (
    <ConnectionGuard>
      <ArchivedContent />
    </ConnectionGuard>
  );
}
