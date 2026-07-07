import type { BaseVO } from "busabase-contract/types";
import { Database } from "lucide-react-native";
import { Text } from "react-native";
import { NativeRow } from "~/components/native-screen";
import { formatDate } from "~/lib/format";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface BaseCardProps {
  base: BaseVO;
  onPress?: () => void;
  last?: boolean;
}

export function BaseCard({ base, onPress, last }: BaseCardProps) {
  const tokens = useTokens();
  return (
    <NativeRow
      title={base.name}
      subtitle={base.description || "No description"}
      meta={`${base.fields.length} fields`}
      leading={<Database size={18} color={tokens.mutedForeground} />}
      last={last}
      onPress={onPress}
    >
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>
        Created {formatDate(base.createdAt)}
      </Text>
    </NativeRow>
  );
}
