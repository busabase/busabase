import type { BaseVO } from "busabase-contract/types";
import { Database } from "lucide-react-native";
import { NativeRow } from "~/components/native-screen";
import { useTokens } from "~/theme/use-tokens";

interface BaseCardProps {
  base: BaseVO;
  onPress?: () => void;
  last?: boolean;
}

// Catalog rows only carry information that distinguishes one Base from the
// next. Full descriptions remain on the detail screen, where they can be read
// without turning this 40+ item index into a wall of truncated copy.
export function BaseCard({ base, onPress, last }: BaseCardProps) {
  const tokens = useTokens();
  return (
    <NativeRow
      title={base.name}
      meta={`${base.fields.length} field${base.fields.length === 1 ? "" : "s"}`}
      leading={<Database size={18} color={tokens.mutedForeground} />}
      last={last}
      onPress={onPress}
    />
  );
}
