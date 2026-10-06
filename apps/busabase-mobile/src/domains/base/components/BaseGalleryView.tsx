import type { BaseFieldVO, GalleryCardSize, RecordVO } from "busabase-contract/types";
import { getRecordTitle } from "busabase-core/dashboard/change-request";
import { resolveCoverField } from "busabase-core/domains/base/utils/view-field-resolution";
import { iStringParse } from "openlib/i18n/i-string";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { NativeEmptyState } from "~/components/native-screen";
import { useConnection } from "~/connection/connection-store";
import { getAttachmentRefs, isImageRef, resolveAttachmentUrl } from "~/lib/attachment";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { BaseDetailController } from "../hooks/use-base-detail-controller";
import { FieldValue } from "./FieldValue";

/** Web's card wall uses CSS `auto-fill`; RN has no equivalent, so a fixed
 * column count per size preset stands in — chosen for a phone-width screen,
 * not a port of web's own minmax breakpoints. */
const COLUMNS_BY_SIZE: Record<GalleryCardSize, number> = { small: 2, medium: 2, large: 1 };

const firstImageUrl = (
  record: RecordVO,
  coverField: BaseFieldVO | null,
  serverUrl: string | null,
): string | null => {
  if (!coverField) return null;
  const ref = getAttachmentRefs(record.headCommit.payload[coverField.slug]).find(isImageRef);
  return ref ? resolveAttachmentUrl(serverUrl, ref.url) : null;
};

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

interface CardProps {
  record: RecordVO;
  bodyFields: BaseFieldVO[];
  coverField: BaseFieldVO | null;
  showFieldLabels: boolean;
  onPress: () => void;
}

function GalleryCard({ record, bodyFields, coverField, showFieldLabels, onPress }: CardProps) {
  const tokens = useTokens();
  const { state } = useConnection();
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;
  const title = getRecordTitle(record);
  const coverUrl = firstImageUrl(record, coverField, serverUrl);

  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.card,
        { borderColor: tokens.border, backgroundColor: tokens.card, opacity: pressed ? 0.8 : 1 },
      ]}
      onPress={onPress}
    >
      <View style={[styles.cover, { backgroundColor: tokens.muted }]}>
        {coverUrl ? (
          <Image source={{ uri: coverUrl }} resizeMode="cover" style={styles.coverImage} />
        ) : (
          <Text style={[typography.h2, { color: tokens.mutedForeground, opacity: 0.6 }]}>
            {coverField ? title.trim().charAt(0).toUpperCase() || "?" : ""}
          </Text>
        )}
      </View>
      <View style={styles.body}>
        <Text numberOfLines={1} style={[typography.bodyEm, { color: tokens.foreground }]}>
          {title}
        </Text>
        {bodyFields.map((field) => (
          <View key={field.id}>
            {showFieldLabels ? (
              <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                {iStringParse(field.name).toUpperCase()}
              </Text>
            ) : null}
            <FieldValue
              field={field}
              value={record.headCommit.payload[field.slug]}
              interactive={false}
            />
          </View>
        ))}
      </View>
    </Pressable>
  );
}

interface Props {
  base: BaseDetailController["base"];
  activeView: BaseDetailController["activeView"];
  fields: BaseFieldVO[];
  records: RecordVO[];
  onOpenRecord: (recordId: string) => void;
}

export function BaseGalleryView({ base, activeView, fields, records, onOpenRecord }: Props) {
  const config = activeView?.config;
  const coverField = resolveCoverField(base, fields, config?.coverFieldSlug);
  const cardSize: GalleryCardSize = config?.cardSize ?? "medium";
  const showFieldLabels = config?.showFieldLabels ?? false;
  const bodyFields = fields.filter((field) => field.slug !== coverField?.slug);
  const columns = COLUMNS_BY_SIZE[cardSize];

  if (records.length === 0) {
    return <NativeEmptyState title="No records" />;
  }

  return (
    <View style={styles.grid}>
      {chunk(records, columns).map((row) => (
        <View key={row[0]?.id ?? "row"} style={styles.row}>
          {row.map((record) => (
            <GalleryCard
              key={record.id}
              record={record}
              bodyFields={bodyFields}
              coverField={coverField}
              showFieldLabels={showFieldLabels}
              onPress={() => onOpenRecord(record.id)}
            />
          ))}
          {row.length < columns
            ? Array.from({ length: columns - row.length }).map((_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length filler, never reordered
                <View key={index} style={styles.card} />
              ))
            : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { paddingHorizontal: spacing[3], paddingVertical: spacing[3], gap: spacing[3] },
  row: { flexDirection: "row", gap: spacing[3] },
  card: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  cover: {
    aspectRatio: 3 / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  coverImage: { width: "100%", height: "100%" },
  body: { padding: spacing[2], gap: 4 },
});
