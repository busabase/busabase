import type { RecordVO } from "busabase-contract/types";
import { StyleSheet, Text, View } from "react-native";
import { NativeRow } from "~/components/native-screen";
import { getStatusLabel, StatusBadge } from "~/components/ui/StatusBadge";
import { getPreview, getRecordTitle } from "~/lib/busabase-display";
import { formatDate } from "~/lib/format";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface RecordCardProps {
  record: RecordVO;
  onPress?: () => void;
  last?: boolean;
}

export function RecordCard({ record, onPress, last }: RecordCardProps) {
  const tokens = useTokens();
  const statusColor = record.status === "active" ? tokens.success : tokens.destructive;

  return (
    <NativeRow
      title={getRecordTitle(record)}
      subtitle={getPreview(record.headCommit.fields)}
      meta={formatDate(record.updatedAt)}
      leading={<View style={[styles.statusDot, { backgroundColor: statusColor }]} />}
      trailing={<StatusBadge status={record.status} compact />}
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
