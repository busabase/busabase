import { getNodeType, hasCapability } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import {
  FolderOpen,
  FolderPlus,
  FolderTree,
  Globe,
  type LucideIcon,
  Pencil,
  Shield,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { NativeBottomSheet, NativeRow } from "~/components/native-screen";
import { useI18n } from "~/i18n";
import { useTokens } from "~/theme/use-tokens";
import { NodeAgentPromptsSheet } from "./NodeAgentPromptsSheet";
import { NodeDeleteSheet } from "./NodeDeleteSheet";
import { NodeMoveSheet } from "./NodeMoveSheet";
import { NodePermissionsSheet } from "./NodePermissionsSheet";
import { NodeRenameSheet } from "./NodeRenameSheet";
import { NodeShareSheet } from "./NodeShareSheet";

interface NodeActionsSheetProps {
  node: NodeVO;
  /** The RAW `nodes.list` tree, for the move picker and inherited privacy. */
  nodes: NodeVO[];
  /** Whether this node type has a mobile detail screen to open. */
  canOpen: boolean;
  /** Whether this node is currently in the actor's Favorites (flips the label). */
  isFavorite: boolean;
  /** Resolved space, for the share link and the Agent-prompt target line. */
  spaceId?: string | null;
  spaceName?: string | null;
  /**
   * The space's default content visibility (`auth.verify` → `space
   * .nodeVisibilityMode`), from the same query as `spaceId`/`spaceName`. The
   * Permissions sheet needs it to describe a node's effective access and to
   * decide whether per-node grants are worth showing.
   */
  spaceVisibilityMode?: "open" | "restricted" | null;
  onClose: () => void;
  onOpenNode: (node: NodeVO) => void;
  onToggleFavorite: (node: NodeVO) => void;
  /**
   * Create a new node INSIDE this one — the touch equivalent of the "+" web
   * puts on every container row (`onAddChild` in `buildNavItem`). Omitted for
   * rows where web strips `onAddChild` too, i.e. the flat Favorites entries.
   */
  onCreateChild?: (node: NodeVO) => void;
}

type Mode = "menu" | "rename" | "move" | "permissions" | "agentPrompts" | "share" | "delete";

interface ActionDef {
  key: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  destructive?: boolean;
}

/**
 * The drawer's per-node "•••" menu — the touch equivalent of the web sidebar's
 * hover-revealed actions menu (`buildNavItem` in dashboard-shell.tsx). Web
 * reveals it on hover, which does not exist on touch, and long-press would be
 * undiscoverable; a persistent trailing "•••" opening a bottom sheet is the
 * standard mobile file-manager pattern.
 *
 * ORDER AND GATING MIRROR `buildNavItem` EXACTLY, item for item:
 *  1. **Open** — only when the node has a detail screen (web builds this from
 *     `nodeHref`, which is null for detail-less types; the mobile drawer
 *     additionally treats `file` as not viewable yet, and passes that in).
 *  2. **Rename** — every type EXCEPT `base`. Bases rename through their own
 *     Design tab, so web never wires `onOpenRename` for them.
 *  3. **Permissions** — every type.
 *  4. **Favorite / Remove from Favorites** — every type; the label reflects the
 *     node's CURRENT membership, so a freshly-favorited row reads "Remove from
 *     Favorites" the next time this sheet opens.
 *  5. **Move to…** — every type.
 *  6. **Agent prompts** — every type, no gate (the sheet only reads the registry).
 *  7. **Share** — gated on `node.slug`, because the public URL is built from it;
 *     a node without one has no link to hand out.
 *  8. **Delete** — LAST, in the destructive token, behind a visual separator, so
 *     it can't be hit by muscle memory aimed at the item above it.
 *
 * Only ever one sheet is visible at a time (`mode`) rather than stacking modals,
 * matching how CommentsSection gates its composer/discard pair.
 */
export function NodeActionsSheet({
  node,
  nodes,
  canOpen,
  isFavorite,
  spaceId,
  spaceName,
  spaceVisibilityMode,
  onClose,
  onOpenNode,
  onToggleFavorite,
  onCreateChild,
}: NodeActionsSheetProps) {
  const tokens = useTokens();
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("menu");

  const typeLabel = getNodeType(node.type)?.label ?? node.type;
  const canRename = node.type !== "base";
  const canShare = !!node.slug;
  // Same gate as web: only container-capable types get a create-child entry.
  const canCreateChild = !!onCreateChild && hasCapability(node.type, "container");

  const actions: ActionDef[] = [
    ...(canOpen
      ? [
          {
            key: "open",
            label: t.nodeActions.open,
            icon: FolderOpen,
            onPress: () => onOpenNode(node),
          },
        ]
      : []),
    // Second, right under Open: web's "+" sits on the row itself, ahead of the
    // "•••" trigger, so this keeps the same precedence. It lives in the sheet
    // rather than as a second button on the row because a 44pt drawer row
    // already carries a chevron and a "•••"; a third ~28pt target next to them
    // is below the comfortable touch minimum and would crowd out the node name.
    ...(canCreateChild && onCreateChild
      ? [
          {
            key: "createChild",
            label: t.nodeActions.createInside,
            icon: FolderPlus,
            onPress: () => onCreateChild(node),
          },
        ]
      : []),
    ...(canRename
      ? [
          {
            key: "rename",
            label: t.nodeActions.rename,
            icon: Pencil,
            onPress: () => setMode("rename"),
          },
        ]
      : []),
    {
      key: "permissions",
      label: t.nodeActions.permissions,
      icon: Shield,
      onPress: () => setMode("permissions"),
    },
    {
      key: "favorite",
      label: isFavorite ? t.favorites.remove : t.favorites.add,
      icon: Star,
      onPress: () => {
        onToggleFavorite(node);
        onClose();
      },
    },
    {
      key: "move",
      label: t.nodeActions.move,
      icon: FolderTree,
      onPress: () => setMode("move"),
    },
    {
      key: "agentPrompts",
      label: t.nodeActions.agentPrompts,
      icon: Sparkles,
      onPress: () => setMode("agentPrompts"),
    },
    ...(canShare
      ? [
          {
            key: "share",
            label: t.nodeActions.share,
            icon: Globe,
            onPress: () => setMode("share"),
          },
        ]
      : []),
    {
      key: "delete",
      label: t.nodeActions.delete,
      icon: Trash2,
      onPress: () => setMode("delete"),
      destructive: true,
    },
  ];

  return (
    <>
      <NativeBottomSheet
        visible={mode === "menu"}
        title={node.name}
        description={typeLabel}
        showCloseButton
        maxHeight="86%"
        onClose={onClose}
      >
        <View style={styles.menu}>
          {actions.map((action, index) => (
            <View
              key={action.key}
              // Web separates Delete from the item above it with a menu
              // separator; on a bottom sheet the same job is done by a gap plus
              // the row above losing its divider, so the red row reads as its
              // own block rather than the next item in the list.
              style={action.destructive ? styles.destructiveBlock : undefined}
            >
              <NativeRow
                title={action.label}
                leading={
                  <action.icon
                    size={18}
                    color={action.destructive ? tokens.destructive : tokens.mutedForeground}
                  />
                }
                destructive={action.destructive}
                last={action.destructive || index === actions.length - 2}
                onPress={action.onPress}
              />
            </View>
          ))}
        </View>
      </NativeBottomSheet>

      {canRename ? (
        <NodeRenameSheet
          visible={mode === "rename"}
          node={node}
          onClose={onClose}
          onBack={() => setMode("menu")}
        />
      ) : null}
      <NodeMoveSheet
        visible={mode === "move"}
        node={node}
        nodes={nodes}
        onClose={onClose}
        onBack={() => setMode("menu")}
      />
      <NodePermissionsSheet
        visible={mode === "permissions"}
        node={node}
        nodes={nodes}
        spaceVisibilityMode={spaceVisibilityMode}
        onClose={onClose}
        onBack={() => setMode("menu")}
      />
      <NodeAgentPromptsSheet
        visible={mode === "agentPrompts"}
        node={node}
        spaceId={spaceId}
        spaceName={spaceName}
        onClose={onClose}
        onBack={() => setMode("menu")}
      />
      {canShare ? (
        <NodeShareSheet
          visible={mode === "share"}
          node={node}
          spaceId={spaceId}
          onClose={onClose}
          onBack={() => setMode("menu")}
        />
      ) : null}
      <NodeDeleteSheet
        visible={mode === "delete"}
        node={node}
        onClose={onClose}
        onBack={() => setMode("menu")}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // NativeRow carries its own horizontal padding; pull it back level with the
  // sheet's title so the action labels line up under it.
  menu: { marginHorizontal: -14 },
  destructiveBlock: { marginTop: 10 },
});
