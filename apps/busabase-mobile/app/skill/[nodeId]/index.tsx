import { skipToken, useQuery } from "@tanstack/react-query";
import type { SkillVO } from "busabase-contract/types";
import { useLocalSearchParams } from "expo-router";
import { FileText, Folder, X } from "lucide-react-native";
import { useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

type SkillFile = SkillVO["files"][number];

interface OpenFile {
  path: string;
  content: string;
  loading: boolean;
  error: string | null;
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function SkillDetailContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);

  const skillQuery = useQuery(
    buda && nodeId
      ? buda.orpc.skills.get.queryOptions({ input: { nodeId } })
      : { queryKey: ["no-connection", "skill", nodeId], queryFn: skipToken },
  );
  const skill = skillQuery.data ?? null;

  const openSkillFile = async (file: SkillFile) => {
    if (file.type !== "file" || !buda) {
      return;
    }
    setOpenFile({ path: file.path, content: "", loading: true, error: null });
    try {
      const result = await buda.client.skills.readFile({ nodeId, filePath: file.path });
      setOpenFile({ path: file.path, content: result.content, loading: false, error: null });
    } catch (error) {
      setOpenFile({
        path: file.path,
        content: "",
        loading: false,
        error: error instanceof Error ? error.message : "Could not read file",
      });
    }
  };

  const metaChips = skill
    ? [
        skill.visibility,
        skill.version ? `v${skill.version}` : null,
        skill.entryFile ? `entry: ${skill.entryFile}` : null,
      ].filter((value): value is string => Boolean(value))
    : [];

  return (
    <DrawerScaffold
      title={skill?.node.name ?? "Skill"}
      subtitle={skill ? `${skill.files.length} files` : "Skill"}
      refreshing={skillQuery.isRefetching}
      onRefresh={() => void skillQuery.refetch()}
    >
      {skillQuery.isLoading ? <NativeLoadingState label="Loading skill" /> : null}
      {skillQuery.error ? (
        <NativeErrorState
          message={skillQuery.error.message}
          onRetry={() => void skillQuery.refetch()}
        />
      ) : null}
      {!skillQuery.isLoading && !skillQuery.error && !skill ? (
        <NativeEmptyState title="Skill not found" description="This skill is not available." />
      ) : null}

      {skill ? (
        <View style={styles.content}>
          {skill.node.description ? (
            <Text style={[typography.body, styles.block, { color: tokens.mutedForeground }]}>
              {skill.node.description}
            </Text>
          ) : null}

          {metaChips.length > 0 ? (
            <View style={[styles.chips, styles.block]}>
              {metaChips.map((chip) => (
                <View
                  key={chip}
                  style={[
                    styles.chip,
                    { backgroundColor: tokens.muted, borderColor: tokens.border },
                  ]}
                >
                  <Text style={[typography.small, { color: tokens.mutedForeground }]}>{chip}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <Text
            style={[typography.caption, styles.sectionLabel, { color: tokens.mutedForeground }]}
          >
            Files
          </Text>
          {skill.files.length === 0 ? (
            <NativeEmptyState title="No files" description="This skill has no files yet." />
          ) : (
            <View style={styles.fileList}>
              {skill.files.map((file) => {
                const isFile = file.type === "file";
                const Icon = isFile ? FileText : Folder;
                return (
                  <Pressable
                    key={file.path}
                    accessibilityRole={isFile ? "button" : undefined}
                    accessibilityLabel={isFile ? `Open ${file.path}` : undefined}
                    disabled={!isFile}
                    style={({ pressed }) => [
                      styles.fileRow,
                      { borderColor: tokens.border, opacity: pressed ? 0.7 : 1 },
                    ]}
                    onPress={() => void openSkillFile(file)}
                  >
                    <Icon size={18} color={tokens.mutedForeground} />
                    <Text
                      numberOfLines={1}
                      style={[typography.body, styles.filePath, { color: tokens.foreground }]}
                    >
                      {file.path}
                    </Text>
                    {isFile ? (
                      <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                        {formatSize(file.size)}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      ) : null}

      <Modal
        animationType="slide"
        transparent
        visible={!!openFile}
        onRequestClose={() => setOpenFile(null)}
      >
        <View style={styles.modalScrim}>
          <View style={[styles.modalCard, { backgroundColor: tokens.surface }]}>
            <View style={[styles.modalHeader, { borderColor: tokens.border }]}>
              <Text
                numberOfLines={1}
                style={[typography.bodyEm, styles.modalTitle, { color: tokens.foreground }]}
              >
                {openFile?.path}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close file"
                hitSlop={mobile.hitSlop}
                onPress={() => setOpenFile(null)}
              >
                <X size={22} color={tokens.foreground} />
              </Pressable>
            </View>
            {openFile?.loading ? (
              <NativeLoadingState label="Reading file" />
            ) : openFile?.error ? (
              <NativeErrorState message={openFile.error} />
            ) : (
              <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
                <Text style={[styles.code, { color: tokens.foreground }]}>{openFile?.content}</Text>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </DrawerScaffold>
  );
}

export default function SkillDetailScreen() {
  return (
    <ConnectionGuard>
      <SkillDetailContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, paddingBottom: 12 },
  block: { marginHorizontal: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  sectionLabel: { marginHorizontal: 20, textTransform: "uppercase" },
  fileList: { marginHorizontal: 20, gap: 4 },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filePath: { flex: 1, minWidth: 0 },
  modalScrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0, 0, 0, 0.38)" },
  modalCard: { maxHeight: "82%", borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { flex: 1, minWidth: 0 },
  modalBody: { paddingHorizontal: 18 },
  modalBodyContent: { paddingVertical: 16 },
  code: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 13,
    lineHeight: 19,
  },
});
