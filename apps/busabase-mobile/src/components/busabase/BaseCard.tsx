import type { BaseVO } from "busabase-contract/types";
import { Database } from "lucide-react-native";
import { Text } from "react-native";
import { NativeRow } from "~/components/native-screen";
import { formatListTime } from "~/lib/format";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface BaseCardProps {
  base: BaseVO;
  onPress?: () => void;
  last?: boolean;
}

// No "No description" filler line when a base has none — an always-present
// gray placeholder line adds visual noise without adding information, same
// principle as ChangeRequestCard only showing its message line when there's
// a real one. Creation date uses the short list-time form, not the full
// date/time, since exact time-of-day isn't useful at list-scan density.
export function BaseCard({ base, onPress, last }: BaseCardProps) {
  const tokens = useTokens();
  return (
    <NativeRow
      title={base.name}
      subtitle={base.description || undefined}
      meta={`${base.fields.length} field${base.fields.length === 1 ? "" : "s"}`}
      leading={<Database size={18} color={tokens.mutedForeground} />}
      last={last}
      onPress={onPress}
    >
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>
        Created {formatListTime(base.createdAt)}
      </Text>
    </NativeRow>
  );
}
