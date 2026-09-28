import type { NodeType } from "busabase-contract/domains";
import { type NodeIcon, resolveNodeIconSource } from "busabase-contract/types";
import { Image, StyleSheet, Text } from "react-native";
import { useConnection } from "~/connection/connection-store";
import { resolveAttachmentUrl } from "~/lib/attachment";
import { nodeIconForType } from "./node-icons";

interface NodeAvatarProps {
  node: { type: NodeType | string; icon?: NodeIcon | null };
  size: number;
  /** Tints the type-icon fallback; an emoji or image carries its own colour. */
  color: string;
}

/**
 * A node's own identity — the emoji or image someone gave it — falling back to
 * its type icon, exactly as web renders it.
 *
 * WHICH of the three to show is decided by `resolveNodeIconSource` in the
 * contract, the same function web uses, so the two cannot disagree. Before
 * this existed every list on the phone called `nodeIconForType` directly: a
 * node given 🚀 on web showed the generic table icon here.
 */
export function NodeAvatar({ node, size, color }: NodeAvatarProps) {
  const { state } = useConnection();
  const source = resolveNodeIconSource(node);

  if (source.kind === "emoji") {
    return (
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[styles.emoji, { fontSize: size * 0.9, lineHeight: size, width: size }]}
      >
        {source.value}
      </Text>
    );
  }
  if (source.kind === "image") {
    // Self-hosted servers hand back `/api/storage/...`; the phone has to name
    // the origin itself.
    const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;
    return (
      <Image
        accessibilityIgnoresInvertColors
        source={{ uri: resolveAttachmentUrl(serverUrl, source.url) }}
        resizeMode="cover"
        style={{
          width: size,
          height: size,
          borderRadius: source.shape === "app" ? size * 0.22 : 4,
        }}
      />
    );
  }
  const Icon = nodeIconForType(node.type);
  return <Icon size={size} color={color} />;
}

const styles = StyleSheet.create({
  emoji: { textAlign: "center" },
});
