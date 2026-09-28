import { skipToken, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Bot, ExternalLink, MessageSquare, PackageOpen, Play } from "lucide-react-native";
import { iStringParse } from "openlib/i18n/i-string";
import { useState } from "react";
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeActionBar,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { InstallFromGithubSheet } from "~/domains/install/components/InstallFromGithubSheet";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { fmt, useI18n } from "~/i18n";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const SCREENSHOT_WIDTH = 260;

function TemplateDetailContent() {
  const params = useLocalSearchParams<{ name?: string }>();
  const name = typeof params.name === "string" ? params.name : "";
  const { t, locale } = useI18n();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const [installOpen, setInstallOpen] = useState(false);

  const catalog = useQuery(
    buda
      ? buda.orpc.templates.list.queryOptions({ input: {} })
      : { queryKey: ["no-connection", "templates"], queryFn: skipToken },
  );
  const template = catalog.data?.templates.find((entry) => entry.name === name) ?? null;

  const title = template
    ? template.displayName
      ? iStringParse(template.displayName, locale)
      : template.name
    : "";

  const contents = template
    ? ([
        [t.templates.bases, template.stats.bases],
        [t.templates.apps, template.stats.airapps],
        [t.templates.documents, template.stats.docs],
        [t.templates.sampleRows, template.stats.records],
        [t.templates.files, template.stats.files],
        [t.templates.folders, template.stats.folders],
      ] as const)
    : [];

  return (
    <DrawerScaffold
      title={title || t.templates.title}
      titleNumberOfLines={2}
      footer={
        template ? (
          <NativeActionBar>
            <Button label={t.templates.install} fullWidth onPress={() => setInstallOpen(true)} />
          </NativeActionBar>
        ) : undefined
      }
    >
      {catalog.isLoading ? <NativeLoadingState label={t.templates.title} /> : null}
      {catalog.isError || catalog.data?.error ? (
        <NativeErrorState
          message={catalog.data?.error ?? t.templates.catalogFailed}
          onRetry={() => void catalog.refetch()}
        />
      ) : null}
      {!catalog.isLoading && !catalog.isError && !catalog.data?.error && !template ? (
        <NativeEmptyState title={fmt(t.templates.missingTemplate, { name })} />
      ) : null}

      {template ? (
        <>
          <View style={styles.header}>
            <Text style={[typography.h2, { color: tokens.foreground }]}>{title}</Text>
            <Text style={[typography.small, { color: tokens.mutedForeground }]}>
              {template.category}
              {template.version ? ` · v${template.version}` : ""}
            </Text>
            <Text style={[typography.body, styles.description, { color: tokens.mutedForeground }]}>
              {iStringParse(template.description, locale)}
            </Text>
            {template.tags.length > 0 ? (
              <View style={styles.tags}>
                {template.tags.map((tag) => (
                  <View key={tag} style={[styles.tag, { backgroundColor: tokens.muted }]}>
                    <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                      {tag}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {template.screenshots.length > 0 || template.video ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.shelf}
            >
              {template.video ? (
                <VideoTile
                  src={template.video}
                  label={t.templates.playVideo}
                  poster={template.screenshots[1] ?? template.screenshots[0]}
                />
              ) : null}
              {template.screenshots.map((src, index) => (
                <Image
                  // biome-ignore lint/suspicious/noArrayIndexKey: the source list itself has no stable id
                  key={index}
                  source={{ uri: src }}
                  resizeMode="cover"
                  style={[styles.screenshot, { backgroundColor: tokens.muted }]}
                />
              ))}
            </ScrollView>
          ) : null}

          {template.agentPrompts.length > 0 ? (
            <NativeSection title={t.templates.promptsTitle}>
              {template.agentPrompts.map((prompt, index) => (
                <NativeRow
                  key={prompt}
                  title={`“${prompt}”`}
                  leading={<MessageSquare size={16} color={tokens.mutedForeground} />}
                  last={index === template.agentPrompts.length - 1}
                />
              ))}
            </NativeSection>
          ) : null}

          <NativeSection title={t.templates.contentsTitle}>
            {contents
              .filter(([, count]) => count > 0)
              .map(([label, count]) => (
                <NativeRow key={label} title={label} meta={String(count)} />
              ))}
            <NativeRow
              title={t.templates.agentManual}
              meta={template.stats.skill ? t.templates.included : t.templates.none}
              leading={<Bot size={16} color={tokens.mutedForeground} />}
              last
            />
          </NativeSection>

          <NativeSection>
            <NativeRow
              title={t.templates.readSource}
              leading={<PackageOpen size={16} color={tokens.mutedForeground} />}
              trailing={<ExternalLink size={16} color={tokens.mutedForeground} />}
              onPress={() => void Linking.openURL(template.sourceUrl).catch(() => undefined)}
              last={!template.license && !template.author}
            />
            {template.license || template.author ? (
              <NativeRow
                title={[template.author, template.license].filter(Boolean).join(" · ")}
                last
              />
            ) : null}
          </NativeSection>
        </>
      ) : null}

      {template ? (
        <InstallFromGithubSheet
          key={template.id}
          visible={installOpen}
          onClose={() => setInstallOpen(false)}
          onReviewChangeRequests={() => setInstallOpen(false)}
          initialRepoUrl={template.install.repoUrl}
          initialIntoFolder={template.install.intoFolder}
        />
      ) : null}
    </DrawerScaffold>
  );
}

/**
 * Markdown has no video syntax and neither does this screen: the demo clip is
 * just a URL, posterized with a screenshot, that opens outside the app. Same
 * "row that plays externally" decision `MarkdownView` makes for a Doc's
 * inline video — not a shared component because the visual shells differ (a
 * shelf tile here, a text row there), but the same reasoning.
 */
function VideoTile({ src, poster, label }: { src: string; poster?: string; label: string }) {
  const tokens = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => void Linking.openURL(src).catch(() => undefined)}
      style={({ pressed }) => [
        styles.screenshot,
        styles.videoTile,
        { backgroundColor: tokens.muted, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {poster ? (
        <Image source={{ uri: poster }} resizeMode="cover" style={StyleSheet.absoluteFill} />
      ) : null}
      <View style={[styles.playBadge, { backgroundColor: tokens.background }]}>
        <Play size={20} color={tokens.foreground} />
      </View>
    </Pressable>
  );
}

export default function TemplateDetailScreen() {
  return (
    <ConnectionGuard>
      <TemplateDetailContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4, gap: 6 },
  description: { lineHeight: 20 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  tag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.md },
  shelf: { paddingHorizontal: 14, paddingVertical: spacing[3], gap: spacing[2] },
  screenshot: { width: SCREENSHOT_WIDTH, aspectRatio: 16 / 10, borderRadius: radius.lg },
  videoTile: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  playBadge: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
});
