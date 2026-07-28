import type { RecordVO } from "busabase-contract/types";
import { getRecordTitle } from "busabase-core/dashboard/change-request";
import { StyleSheet, View } from "react-native";
import { NativeRow } from "~/components/native-screen";
import { getStatusLabel } from "~/components/ui/StatusBadge";
import { formatListTime } from "~/lib/format";
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

  return (
    <NativeRow
      title={title}
      subtitle={`${record.base.name} · ${getStatusLabel(record.status)}`}
      meta={formatListTime(record.updatedAt)}
      leading={<View style={[styles.statusDot, { backgroundColor: statusColor }]} />}
      last={last}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
});
