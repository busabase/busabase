import { getRecordTitle } from "busabase-core/dashboard/change-request";
import { iStringParse } from "openlib/i18n/i-string";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { NativeSection } from "~/components/native-screen";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { BaseDetailController } from "../hooks/use-base-detail-controller";
import { FieldValue } from "./FieldValue";

const FIRST_COLUMN_WIDTH = 180;
const COLUMN_WIDTH = 140;

interface Props {
  fields: BaseDetailController["previewFields"];
  records: BaseDetailController["records"];
  onOpenRecord: (recordId: string) => void;
}

export function BaseRecordTable({ fields, records, onOpenRecord }: Props) {
  const tokens = useTokens();

  return (
    <NativeSection title="Table" caption={`${fields.length} fields`}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        style={styles.tableScroll}
        contentContainerStyle={styles.tableContent}
      >
        <View>
          <View style={[styles.tableHeader, { borderColor: tokens.border }]}>
            <Text style={[typography.caption, styles.firstCell, { color: tokens.mutedForeground }]}>
              TITLE
            </Text>
            {fields.map((field) => (
              <Text
                key={field.id}
                numberOfLines={1}
                style={[typography.caption, styles.cell, { color: tokens.mutedForeground }]}
              >
                {iStringParse(field.name).toUpperCase()}
              </Text>
            ))}
          </View>
          {records.map((record, index) => (
            <Pressable
              key={record.id}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.tableRow,
                index === records.length - 1 ? styles.tableRowLast : null,
                { borderColor: tokens.border, opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={() => onOpenRecord(record.id)}
            >
              <Text
                numberOfLines={1}
                style={[typography.bodyEm, styles.firstCell, { color: tokens.foreground }]}
              >
                {getRecordTitle(record)}
              </Text>
              {fields.map((field) => (
                <View key={field.id} style={styles.cell}>
                  <FieldValue
                    field={field}
                    value={record.headCommit.payload[field.slug]}
                    interactive={false}
                  />
                </View>
              ))}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </NativeSection>
  );
}

const styles = StyleSheet.create({
  tableScroll: { flexGrow: 0 },
  tableContent: { paddingLeft: 14 },
  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    paddingRight: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingVertical: 8,
    paddingRight: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableRowLast: { borderBottomWidth: 0 },
  firstCell: { width: FIRST_COLUMN_WIDTH },
  cell: { width: COLUMN_WIDTH, overflow: "hidden" },
});
