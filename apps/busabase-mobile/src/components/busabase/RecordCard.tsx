import type { RecordVO } from "busabase-contract/types";
import { StyleSheet, Text, View } from "react-native";
import { NativeRow } from "~/components/native-screen";
import { getStatusLabel } from "~/components/ui/StatusBadge";
import { getPreview, getRecordTitle } from "~/lib/busabase-display";
import { formatListTime } from "~/lib/format";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface RecordCardProps {
  record: RecordVO;
  onPress?: () => void;
  last?: boolean;
}

// Status carries color via the leading dot only; the word appears once, in
// the metadata line below — no separate colored chip (see
// ChangeRequestCard.tsx for the same fix and its web-parity rationale).
export function RecordCard({ record, onPress, last }: RecordCardProps) {
  const tokens = useTokens();
  const statusColor = record.status === "active" ? tokens.success : tokens.destructive;
  const title = getRecordTitle(record);
  const preview = getPreview(record.headCommit.fields);
  // Sparse (often single-field) records can make the preview echo the title
  // verbatim — drop it rather than show the same text twice.
  const subtitle =
    preview.trim().toLowerCase() === title.trim().toLowerCase() ? undefined : preview;

  return (
    <NativeRow
      title={title}
      subtitle={subtitle}
      meta={formatListTime(record.updatedAt)}
      leading={<View style={[styles.statusDot, { backgroundColor: statusColor }]} />}
      last={last}
      onPress={onPress}
    >
      <View>
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          {record.base.name} · {getStatusLabel(record.status)}
        </Text>
      </View>
    </NativeRow>
  );
}

const styles = StyleSheet.create({
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
});
