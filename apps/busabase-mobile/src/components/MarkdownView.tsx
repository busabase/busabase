import { markdownPreviewSource } from "busabase-core/dashboard/markdown-preview";
import { Play } from "lucide-react-native";
import { useMemo } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Markdown, { type RenderRules } from "react-native-markdown-display";
import Svg, { Defs, Rect, Stop, LinearGradient as SvgLinearGradient } from "react-native-svg";
import { useConnection } from "~/connection/connection-store";
import { resolveAttachmentUrl } from "~/lib/attachment";
import { markdownMediaFor } from "~/lib/markdown-media";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface MarkdownViewProps {
  children: string;
}

/**
 * Markdown as formatted text — the phone's reading view of what web renders
 * with its Doc editor.
 *
 * Before this, a Doc body was dropped into a plain `<Text>`, so `# Heading`,
 * `**bold**` and `- item` reached the reader as the raw symbols.
 *
 * Leading YAML frontmatter (every `SKILL.md`) is shown as a code block via
 * `markdownPreviewSource`, the same transform web applies — parsed as prose it
 * became a large "name: … description: …" heading.
 *
 * Two behaviours are deliberately NOT the library's defaults:
 *
 * - Relative sources. A self-hosted server hands back `/api/storage/...`; the
 *   library's fallback prefixes `https://`, producing `https:///api/...` — a
 *   broken image every time. Images and links resolve against the connected
 *   server instead, exactly as attachments already do.
 * - Video. Markdown has no video syntax, so a Doc carries one as an image
 *   (`![caption](clip.mp4)`). Drawn as an image it is a broken picture; here it
 *   is a row that opens the clip. What counts as a video is web's own rule
 *   (`isPlayableVideoUrl`), not a copy of it.
 */
export function MarkdownView({ children }: MarkdownViewProps) {
  const tokens = useTokens();
  const { state } = useConnection();
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;

  const style = useMemo(
    () =>
      StyleSheet.create({
        body: { ...typography.body, color: tokens.foreground },
        paragraph: { marginTop: 0, marginBottom: 10 },
        heading1: { ...typography.h1, color: tokens.foreground, marginTop: 12, marginBottom: 8 },
        heading2: { ...typography.h2, color: tokens.foreground, marginTop: 12, marginBottom: 6 },
        heading3: { ...typography.h3, color: tokens.foreground, marginTop: 10, marginBottom: 6 },
        heading4: { ...typography.bodyEm, color: tokens.foreground, marginTop: 8, marginBottom: 4 },
        heading5: { ...typography.bodyEm, color: tokens.foreground },
        heading6: { ...typography.bodyEm, color: tokens.mutedForeground },
        strong: { fontWeight: "600" },
        link: { color: tokens.foreground, textDecorationLine: "underline" },
        blockquote: {
          backgroundColor: "transparent",
          borderLeftColor: tokens.border,
          borderLeftWidth: 3,
          paddingHorizontal: 12,
          marginLeft: 0,
        },
        // The library's default gives inline code `padding: 10` and a border,
        // so the chip is taller than the line and covers the one below it.
        code_inline: {
          backgroundColor: tokens.muted,
          color: tokens.foreground,
          borderRadius: 4,
          borderWidth: 0,
          padding: 0,
          paddingHorizontal: 4,
        },
        code_block: {
          backgroundColor: tokens.muted,
          color: tokens.foreground,
          borderRadius: 6,
          borderWidth: 0,
        },
        fence: {
          backgroundColor: tokens.muted,
          color: tokens.foreground,
          borderRadius: 6,
          borderWidth: 0,
        },
        hr: { backgroundColor: tokens.border, marginVertical: 12 },
        table: { borderColor: tokens.border },
        th: { borderColor: tokens.border },
        td: { borderColor: tokens.border },
        tr: { borderColor: tokens.border },
        bullet_list_icon: { color: tokens.mutedForeground },
        ordered_list_icon: { color: tokens.mutedForeground },
      }),
    [tokens],
  );

  const rules = useMemo<RenderRules>(
    () => ({
      image: (node) => {
        const src = String(node.attributes.src ?? "");
        const alt = typeof node.attributes.alt === "string" ? node.attributes.alt : "";
        const { kind, uri } = markdownMediaFor(src, serverUrl);
        if (kind === "video") {
          return (
            <Pressable
              key={node.key}
              accessibilityRole="link"
              accessibilityLabel={alt || src}
              onPress={() => void Linking.openURL(uri).catch(() => undefined)}
              style={({ pressed }) => [
                videoStyles.row,
                { borderColor: tokens.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Play size={18} color={tokens.foreground} />
              <Text
                numberOfLines={1}
                style={[typography.body, videoStyles.label, { color: tokens.foreground }]}
              >
                {alt || src.split("/").pop() || src}
              </Text>
            </Pressable>
          );
        }
        return (
          <Image
            key={node.key}
            accessibilityLabel={alt || undefined}
            source={{ uri }}
            resizeMode="contain"
            style={imageStyles.image}
          />
        );
      },
    }),
    [serverUrl, tokens],
  );

  return (
    <Markdown
      style={style}
      rules={rules}
      onLinkPress={(url) => {
        void Linking.openURL(resolveAttachmentUrl(serverUrl, url)).catch(() => undefined);
        return false;
      }}
    >
      {markdownPreviewSource(children)}
    </Markdown>
  );
}

const imageStyles = StyleSheet.create({
  image: { width: "100%", aspectRatio: 16 / 9, marginVertical: 8, borderRadius: 6 },
});

const videoStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 8,
  },
  label: { flex: 1, minWidth: 0 },
});

interface CollapsedMarkdownProps {
  children: string;
  collapsed: boolean;
  /** Visible height while collapsed. */
  maxHeight: number;
}

/**
 * Markdown that can be folded to a fixed height.
 *
 * Folded by HEIGHT, never by cutting the source: truncating markdown at a line
 * can split a list or a code fence, and the rest then renders as something the
 * author never wrote. A height cut lands mid-line, so the bottom fades into the
 * background instead of showing half a row of text.
 */
export function CollapsedMarkdown({ children, collapsed, maxHeight }: CollapsedMarkdownProps) {
  const tokens = useTokens();
  return (
    <View style={collapsed ? { maxHeight, overflow: "hidden" } : null}>
      <MarkdownView>{children}</MarkdownView>
      {collapsed ? (
        <View pointerEvents="none" style={fadeStyles.fade}>
          <Svg width="100%" height="100%">
            <Defs>
              <SvgLinearGradient id="markdown-fade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={tokens.background} stopOpacity={0} />
                <Stop offset="1" stopColor={tokens.background} stopOpacity={1} />
              </SvgLinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#markdown-fade)" />
          </Svg>
        </View>
      ) : null}
    </View>
  );
}

const fadeStyles = StyleSheet.create({
  fade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 44 },
});
