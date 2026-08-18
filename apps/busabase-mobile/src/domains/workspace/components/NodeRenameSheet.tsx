import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { NodeVO } from "busabase-contract/types";
import { useState } from "react";
import { Text } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { NativeActionBar, NativeBottomSheet, NativeInlineError } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { useI18n } from "~/i18n";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface NodeRenameSheetProps {
  visible: boolean;
  node: NodeVO;
  onClose: () => void;
  onBack: () => void;
}

/**
 * Mobile port of `node-rename-dialog.tsx`. Same submit path as the web dialog:
 * the generic `nodes.createChangeRequest` endpoint with a `kind: "rename"`
 * operation, and the same two-way choice the web `SplitSubmitButton` offers —
 * "Rename now" (create + approve + merge in one go) vs "Request rename"
 * (create only, leave it in the Inbox for review).
 *
 * Unlike web, both buttons are always shown in a fixed order: web reorders
 * them by the caller's API-key permission level via `resolveSubmitActionOrder`,
 * which the mobile app has no equivalent of today — it never resolves an
 * effective permission level client-side. A "Rename now" the actor isn't
 * allowed to perform fails server-side and surfaces in the inline error, same
 * as any other over-privileged call from this app.
 */
export function NodeRenameSheet({ visible, node, onClose, onBack }: NodeRenameSheetProps) {
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const [name, setName] = useState(node.name);

  // Invalidates BOTH the drawer's whole-tree query (`nodes.list` — the one
  // query every rename MUST refresh) AND every detail-screen query keyed by
  // this node's id or slug, since each node type's own `*.get` query is keyed
  // by the ROUTE SLUG rather than the database id. Same generic predicate the
  // web dialog uses, for the same reason: no per-caller wiring across the
  // five-plus detail screens. Cheap — it runs once, right after a rename
  // actually commits.
  const invalidateNodes = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: buda?.orpc.nodes.list.key() }),
      queryClient.invalidateQueries({
        predicate: (query) => {
          const keyStr = JSON.stringify(query.queryKey);
          return keyStr.includes(node.id) || keyStr.includes(node.slug);
        },
      }),
    ]);
  };

  const renameMutation = useMutation({
    mutationFn: async ({ mergeImmediately }: { mergeImmediately: boolean }) => {
      const trimmed = name.trim();
      if (!buda) throw new Error(t.common.notConnected);
      if (!trimmed) throw new Error(t.rename.nameRequired);
      const changeRequest = await buda.client.nodes.createChangeRequest({
        operations: [{ kind: "rename", nodeId: node.id, name: trimmed }],
      });
      if (mergeImmediately) {
        await buda.client.changeRequests.review({
          changeRequestIds: [changeRequest.id],
          verdict: "approved",
        });
        await buda.client.changeRequests.merge({ changeRequestIds: [changeRequest.id] });
      }
      return { changeRequest, merged: mergeImmediately };
    },
    onSuccess: async () => {
      await invalidateNodes();
      onClose();
    },
  });

  const close = () => {
    if (renameMutation.isPending) return;
    renameMutation.reset();
    setName(node.name);
    onBack();
  };

  const trimmed = name.trim();

  return (
    <NativeBottomSheet
      visible={visible}
      title={t.rename.title}
      description={node.name}
      showCloseButton
      onClose={close}
      footer={
        <NativeActionBar>
          {renameMutation.error ? (
            <NativeInlineError
              message={renameMutation.error.message || t.rename.failed}
              onReset={() => renameMutation.reset()}
            />
          ) : null}
          <Button
            label={t.rename.renameNow}
            loading={renameMutation.isPending}
            disabled={trimmed.length === 0}
            fullWidth
            onPress={() => renameMutation.mutate({ mergeImmediately: true })}
          />
          <Button
            label={t.rename.requestRename}
            variant="secondary"
            disabled={renameMutation.isPending || trimmed.length === 0}
            fullWidth
            onPress={() => renameMutation.mutate({ mergeImmediately: false })}
          />
          <Button label={t.nodeActions.back} variant="ghost" fullWidth onPress={close} />
        </NativeActionBar>
      }
    >
      <TextInput
        label={t.rename.nameLabel}
        placeholder={t.rename.namePlaceholder}
        value={name}
        autoFocus
        autoCapitalize="sentences"
        onChangeText={setName}
      />
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>
        {t.rename.requestReviewHint}
      </Text>
    </NativeBottomSheet>
  );
}
