import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getNodeType } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import { Trash2 } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { NativeActionBar, NativeBottomSheet, NativeInlineError } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { fmt, useI18n } from "~/i18n";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface NodeDeleteSheetProps {
  visible: boolean;
  node: NodeVO;
  onClose: () => void;
  onBack: () => void;
}

/**
 * Mobile port of `NodeDeleteDialog` (file-tree-browser.tsx). Deleting ARCHIVES
 * the node to Trash — it stays restorable from the Archive screen — so the copy
 * says exactly that instead of threatening permanence, and a folder gets the
 * variant that names how many items go with it (a folder takes its whole subtree
 * along, which is the one genuinely surprising part of this action).
 *
 * Same submit path as web: one `nodes.createChangeRequest` with a `kind:
 * "delete"` operation, immediately approved and merged. Unlike Rename, there is
 * no "request delete" half — web offers a single destructive confirm here, and
 * splitting it on mobile alone would make the two platforms mean different
 * things by the same red button.
 */
export function NodeDeleteSheet({ visible, node, onClose, onBack }: NodeDeleteSheetProps) {
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();

  const typeLabel = getNodeType(node.type)?.label ?? node.type;
  // `children` is the loaded subtree from `nodes.list`; `hasChildren` covers a
  // node sitting at a depth boundary whose children weren't fetched.
  const childCount = node.children.length;
  const body =
    node.type === "folder" && childCount > 0
      ? fmt(t.nodeDelete.folderBody, { name: node.name, count: childCount })
      : fmt(t.nodeDelete.body, { name: node.name });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!buda) throw new Error(t.common.notConnected);
      const changeRequest = await buda.client.nodes.createChangeRequest({
        operations: [{ kind: "delete", nodeId: node.id }],
      });
      await buda.client.changeRequests.review({
        changeRequestId: changeRequest.id,
        verdict: "approved",
      });
      await buda.client.changeRequests.merge({ changeRequestId: changeRequest.id });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: buda?.orpc.nodes.list.key() }),
        queryClient.invalidateQueries({ queryKey: buda?.orpc.nodes.list.key() }),
        // A deleted node drops out of Favorites server-side (listFavorites filters
        // archived nodes), so the drawer's Favorites section must refetch too.
        queryClient.invalidateQueries({ queryKey: buda?.orpc.nodes.listFavorites.key() }),
      ]);
      onClose();
    },
  });

  const close = () => {
    if (deleteMutation.isPending) return;
    deleteMutation.reset();
    onBack();
  };

  return (
    <NativeBottomSheet
      visible={visible}
      title={fmt(t.nodeDelete.title, { type: typeLabel })}
      description={node.name}
      showCloseButton
      onClose={close}
      footer={
        <NativeActionBar>
          {deleteMutation.error ? (
            <NativeInlineError
              message={
                deleteMutation.error.message || fmt(t.nodeDelete.failed, { type: typeLabel })
              }
              onReset={() => deleteMutation.reset()}
            />
          ) : null}
          <Button
            label={t.nodeDelete.confirm}
            variant="destructive"
            loading={deleteMutation.isPending}
            fullWidth
            onPress={() => deleteMutation.mutate()}
          />
          <Button label={t.common.cancel} variant="ghost" fullWidth onPress={close} />
        </NativeActionBar>
      }
    >
      <View style={[styles.warning, { backgroundColor: tokens.muted }]}>
        <Trash2 size={18} color={tokens.destructive} />
        <Text style={[typography.small, styles.warningText, { color: tokens.foreground }]}>
          {body}
        </Text>
      </View>
    </NativeBottomSheet>
  );
}

const styles = StyleSheet.create({
  warning: {
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  warningText: { flex: 1, minWidth: 0 },
});
