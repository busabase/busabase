import type { AssetAttachmentRef } from "busabase-contract/types";
import { driveEntryPath } from "busabase-core/base/drive-field-value";
import { fileTreeFileName, fileTreeParentPath } from "busabase-core/dashboard/file-tree-files";
import { ExternalLink, FileText } from "lucide-react-native";
import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useConnection } from "~/connection/connection-store";
import { useI18n } from "~/i18n";
import {
  getAttachmentKindLabel,
  getAttachmentRefs,
  isImageRef,
  resolveAttachmentUrl,
} from "~/lib/attachment";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface AttachmentValueProps {
  value: unknown;
  interactive: boolean;
  /**
   * A `drive` cell: the same refs, each with a `path`. Every file is listed as
   * a row in path order with its folder in front of its name, so the folder
   * structure reads even in a table cell — images included, rather than being
   * lifted out into a thumbnail strip that would hide where they live.
   */
  drive?: boolean;
}

/** Renders an `attachment` or `drive` field value: image thumbnails + tappable file chips. */
export function AttachmentValue({ value, interactive, drive = false }: AttachmentValueProps) {
  const tokens = useTokens();
  const { t } = useI18n();
  const { state } = useConnection();
  const [selectedRef, setSelectedRef] = useState<AssetAttachmentRef | null>(null);
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;
  const refs = getAttachmentRefs(value);
  const selectedUrl = selectedRef ? resolveAttachmentUrl(serverUrl, selectedRef.url) : null;

  if (refs.length === 0) {
    return <Text style={[typography.body, { color: tokens.mutedForeground }]}>-</Text>;
  }

  const images = drive ? [] : refs.filter(isImageRef);
  const others = drive
    ? [...refs].sort((left, right) =>
        driveEntryPath(left).localeCompare(driveEntryPath(right), undefined, { numeric: true }),
      )
    : refs.filter((ref) => !isImageRef(ref));
  const open = (ref: AssetAttachmentRef) =>
    void Linking.openURL(resolveAttachmentUrl(serverUrl, ref.url)).catch(() => undefined);
  const selectedFolder =
    selectedRef && drive ? fileTreeParentPath(driveEntryPath(selectedRef)) : "";

  // `contracts/2026/` muted, then `main.pdf`; a long path gives way at its
  // start so the file name itself stays readable.
  const fileLabel = (ref: AssetAttachmentRef, color: string) => {
    const path = drive ? driveEntryPath(ref) : ref.fileName;
    const folder = drive ? fileTreeParentPath(path) : "";
    return (
      <Text
        numberOfLines={1}
        ellipsizeMode={drive ? "head" : "tail"}
        style={[typography.small, styles.fileName, { color }]}
      >
        {folder ? <Text style={{ color: tokens.mutedForeground }}>{`${folder}/`}</Text> : null}
        {drive ? fileTreeFileName(path) : ref.fileName}
      </Text>
    );
  };
  const fileIcon = (ref: AssetAttachmentRef, color: string) =>
    drive && isImageRef(ref) ? (
      <Image
        source={{ uri: resolveAttachmentUrl(serverUrl, ref.url) }}
        resizeMode="cover"
        style={[styles.fileThumb, { borderColor: tokens.border }]}
      />
    ) : (
      <FileText size={14} color={color} />
    );

  return (
    <>
      <View style={styles.attachmentList}>
        {images.length > 0 ? (
          <View style={styles.attachmentImages}>
            {images.map((ref) => (
              <View key={ref.id}>
                {interactive ? (
                  <Pressable
                    accessibilityRole="imagebutton"
                    accessibilityLabel={`View ${getAttachmentKindLabel(ref)} ${ref.fileName}`}
                    onPress={() => setSelectedRef(ref)}
                  >
                    <Image
                      source={{ uri: resolveAttachmentUrl(serverUrl, ref.url) }}
                      resizeMode="cover"
                      style={[styles.attachmentThumb, { borderColor: tokens.border }]}
                    />
                  </Pressable>
                ) : (
                  <Image
                    source={{ uri: resolveAttachmentUrl(serverUrl, ref.url) }}
                    resizeMode="cover"
                    style={[styles.attachmentThumb, { borderColor: tokens.border }]}
                  />
                )}
              </View>
            ))}
          </View>
        ) : null}
        {others.length > 0 ? (
          <View style={styles.attachmentRows}>
            {others.map((ref) => (
              <View
                key={ref.id}
                style={[
                  styles.fileRow,
                  { backgroundColor: tokens.surface, borderColor: tokens.border },
                ]}
              >
                {interactive ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View ${getAttachmentKindLabel(ref)} ${drive ? driveEntryPath(ref) : ref.fileName}`}
                    style={styles.fileAction}
                    onPress={() => setSelectedRef(ref)}
                  >
                    {fileIcon(ref, tokens.primary)}
                    {fileLabel(ref, tokens.primary)}
                  </Pressable>
                ) : (
                  <>
                    {fileIcon(ref, tokens.mutedForeground)}
                    {fileLabel(ref, tokens.foreground)}
                  </>
                )}
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <NativeBottomSheet
        visible={!!selectedRef}
        title={selectedRef?.fileName}
        description={selectedRef ? getAttachmentKindLabel(selectedRef) : undefined}
        showCloseButton
        onClose={() => setSelectedRef(null)}
        footer={
          selectedRef ? (
            <NativeActionBar>
              <Button
                label="Open file"
                fullWidth
                leadingIcon={<ExternalLink size={18} color={tokens.primaryForeground} />}
                onPress={() => open(selectedRef)}
              />
              <Button label="Done" variant="ghost" fullWidth onPress={() => setSelectedRef(null)} />
            </NativeActionBar>
          ) : undefined
        }
      >
        {selectedRef && selectedUrl && isImageRef(selectedRef) ? (
          <Image
            source={{ uri: selectedUrl }}
            resizeMode="contain"
            style={[styles.attachmentPreview, { backgroundColor: tokens.muted }]}
          />
        ) : null}
        {selectedRef ? (
          <NativeSection title="File">
            <NativeRow title="Name" subtitle={selectedRef.fileName} />
            {drive ? (
              <NativeRow title={t.driveField.folder} subtitle={selectedFolder || t.fileTree.root} />
            ) : null}
            <NativeRow
              title="Type"
              subtitle={selectedRef.mimeType || getAttachmentKindLabel(selectedRef)}
              last
            />
          </NativeSection>
        ) : null}
      </NativeBottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  attachmentList: { gap: 8 },
  attachmentImages: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  attachmentThumb: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  attachmentRows: { gap: 6 },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  fileAction: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  fileName: { flex: 1, minWidth: 0 },
  fileThumb: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  attachmentPreview: { width: "100%", height: 220, borderRadius: radius.md },
});
