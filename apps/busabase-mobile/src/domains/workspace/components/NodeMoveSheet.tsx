import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { NodeVO } from "busabase-contract/types";
import { Check, Folder, FolderTree } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { NativeActionBar, NativeBottomSheet, NativeInlineError } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { fmt, useI18n } from "~/i18n";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { flattenMoveTargets } from "../utils/node-move-targets";

interface NodeMoveSheetProps {
  visible: boolean;
  node: NodeVO;
  /**
   * The RAW `nodes.list` tree, not the drawer's unwrapped view: when the space
   * has a single root container, `nodes[0]` doubles as the "Root" destination,
   * since `nodes.move`'s `parentNodeId` always names a real container node,
   * never an implicit null.
   */
  nodes: NodeVO[];
  onClose: () => void;
  onBack: () => void;
}

/**
 * Mobile port of `node-move-dialog.tsx`: an indented folder picker built from
 * the SAME node tree the drawer already loaded (no extra fetch), restricted to
 * container-capable nodes and excluding the node being moved plus every one of
 * its own descendants (`flattenMoveTargets`).
 *
 * Commits through the same auto-merging `nodes.move` endpoint web's
 * drag-and-drop uses. The mobile drawer loads the whole tree, so the local
 * descendant exclusion is already authoritative — but the server-side
 * `nodes.isDescendant` guard web applies before committing a drop is kept here
 * too (one cheap call, only on confirm) so a stale cached tree can't sneak a
 * cycle past the picker.
 */
export function NodeMoveSheet({ visible, node, nodes, onClose, onBack }: NodeMoveSheetProps) {
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rootId = nodes.length === 1 ? nodes[0].id : null;
  const rows = useMemo(() => flattenMoveTargets(nodes, node.id), [nodes, node.id]);
  // `flattenMoveTargets` already emits the root container as its own depth-0
  // row when there is one, so listing it again under the "Root" label would
  // duplicate it. Keep the explicit Root row and drop the duplicate.
  const pickerRows = rootId ? rows.filter((row) => row.id !== rootId) : rows;

  const moveMutation = useMutation({
    mutationFn: async (parentNodeId: string) => {
      if (!buda) throw new Error(t.common.notConnected);
      if (parentNodeId === node.id) throw new Error(t.move.invalidTarget);
      const { isDescendant } = await buda.client.nodes.isDescendant({
        nodeId: parentNodeId,
        potentialAncestorId: node.id,
      });
      if (isDescendant) throw new Error(t.move.invalidTarget);
      return buda.client.nodes.move({ nodeId: node.id, parentNodeId });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: buda?.orpc.nodes.list.key() });
      onClose();
    },
  });

  const close = () => {
    if (moveMutation.isPending) return;
    moveMutation.reset();
    setSelectedId(null);
    onBack();
  };

  const isEmpty = pickerRows.length === 0 && !rootId;

  return (
    <NativeBottomSheet
      visible={visible}
      title={t.move.title}
      description={fmt(t.move.description, { name: node.name })}
      showCloseButton
      maxHeight="86%"
      onClose={close}
      footer={
        <NativeActionBar>
          {moveMutation.error ? (
            <NativeInlineError
              message={moveMutation.error.message || t.move.failed}
              onReset={() => moveMutation.reset()}
            />
          ) : null}
          <Button
            label={t.move.confirm}
            loading={moveMutation.isPending}
            disabled={!selectedId}
            fullWidth
            onPress={() => selectedId && moveMutation.mutate(selectedId)}
          />
          <Button label={t.nodeActions.back} variant="ghost" fullWidth onPress={close} />
        </NativeActionBar>
      }
    >
      {isEmpty ? (
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>{t.move.empty}</Text>
      ) : (
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {rootId ? (
            <MoveTargetRow
              icon={FolderTree}
              label={t.move.root}
              depth={0}
              selected={selectedId === rootId}
              onPress={() => setSelectedId(rootId)}
            />
          ) : null}
          {pickerRows.map((row) => (
            <MoveTargetRow
              key={row.id}
              icon={Folder}
              label={row.name}
              depth={row.depth}
              selected={selectedId === row.id}
              onPress={() => setSelectedId(row.id)}
            />
          ))}
        </ScrollView>
      )}
    </NativeBottomSheet>
  );
}

function MoveTargetRow({
  icon: Icon,
  label,
  depth,
  selected,
  onPress,
}: {
  icon: typeof Folder;
  label: string;
  depth: number;
  selected: boolean;
  onPress: () => void;
}) {
  const tokens = useTokens();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: selected ? tokens.primaryMuted : "transparent",
          paddingLeft: 10 + depth * 14,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
      onPress={onPress}
    >
      <Icon size={18} color={selected ? tokens.primary : tokens.mutedForeground} />
      <Text
        numberOfLines={1}
        style={[
          selected ? typography.bodyEm : typography.body,
          styles.rowLabel,
          { color: selected ? tokens.foreground : tokens.mutedForeground },
        ]}
      >
        {label}
      </Text>
      {selected ? <Check size={18} color={tokens.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 320 },
  row: {
    minHeight: 44,
    borderRadius: radius.md,
    paddingRight: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  rowLabel: { flex: 1, minWidth: 0 },
});
