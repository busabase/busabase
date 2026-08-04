import { skipToken, useQuery } from "@tanstack/react-query";
import type { BaseVO } from "busabase-contract/types";
import { useRouter } from "expo-router";
import { Database } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { BaseGraph } from "~/components/busabase/BaseGraph";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { getBaseGraphGrid, summarizeBaseGraphRelations } from "~/lib/base-graph-layout";
import { getAppNavigationLayout } from "~/lib/responsive-layout";
import { mobile, spacing } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface BaseRelationshipListProps {
  bases: BaseVO[];
  onNodePress: (slug: string) => void;
}

function BaseRelationshipList({ bases, onNodePress }: BaseRelationshipListProps) {
  const tokens = useTokens();
  const { edgeCount, relationCountByBaseId } = useMemo(
    () => summarizeBaseGraphRelations(bases),
    [bases],
  );
  const orderedBases = useMemo(
    () =>
      [...bases].sort((left, right) => {
        const countDifference =
          (relationCountByBaseId.get(right.id) ?? 0) - (relationCountByBaseId.get(left.id) ?? 0);
        return countDifference || left.name.localeCompare(right.name);
      }),
    [bases, relationCountByBaseId],
  );
  const connectedBases = orderedBases.filter(
    (base) => (relationCountByBaseId.get(base.id) ?? 0) > 0,
  );
  const unconnectedBases = orderedBases.filter(
    (base) => (relationCountByBaseId.get(base.id) ?? 0) === 0,
  );

  if (bases.length === 0) {
    return <NativeEmptyState title="No bases yet" description="Bases appear here when created." />;
  }

  return (
    <View style={styles.relationshipList}>
      {connectedBases.length > 0 ? (
        <NativeSection title="Relationships" caption={`${edgeCount}`}>
          {connectedBases.map((base, index) => {
            const relationCount = relationCountByBaseId.get(base.id) ?? 0;
            return (
              <NativeRow
                key={base.id}
                title={base.name}
                meta={`${relationCount} ${relationCount === 1 ? "link" : "links"}`}
                leading={<Database size={18} color={tokens.mutedForeground} />}
                onPress={() => onNodePress(base.slug)}
                last={index === connectedBases.length - 1}
              />
            );
          })}
        </NativeSection>
      ) : null}
      {unconnectedBases.length > 0 ? (
        <NativeSection title="Unconnected" caption={`${unconnectedBases.length}`}>
          {unconnectedBases.map((base, index) => (
            <NativeRow
              key={base.id}
              title={base.name}
              leading={<Database size={18} color={tokens.mutedForeground} />}
              onPress={() => onNodePress(base.slug)}
              last={index === unconnectedBases.length - 1}
            />
          ))}
        </NativeSection>
      ) : null}
    </View>
  );
}

function GraphContent() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const buda = useBusabaseOrpc();
  const query = useQuery(
    buda
      ? buda.orpc.bases.list.queryOptions({ input: {} })
      : { queryKey: ["no-connection", "bases", "list"], queryFn: skipToken },
  );

  const bases = query.data ?? [];
  const navigationLayout = getAppNavigationLayout(width, height);
  const graphWidth = Math.max(320, width - navigationLayout.sidebarWidth);
  const screenHeight = Math.max(
    300,
    height - (mobile.headerHeight ?? 52) - spacing[8] - spacing[4],
  );

  const graphHeight = useMemo(() => {
    const grid = getBaseGraphGrid(bases.length, graphWidth);
    return Math.max(screenHeight, grid.minHeight);
  }, [bases.length, graphWidth, screenHeight]);

  const handleNodePress = useCallback(
    (slug: string) => {
      router.push({ pathname: "/base/[slug]", params: { slug } });
    },
    [router],
  );

  return (
    <DrawerScaffold title="Graph">
      {query.isLoading ? <NativeLoadingState label="Loading bases…" /> : null}
      {query.error ? (
        <NativeErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isLoading && !query.error ? (
        navigationLayout.persistentSidebar ? (
          <BaseGraph
            bases={bases}
            width={graphWidth}
            height={graphHeight}
            onNodePress={handleNodePress}
          />
        ) : (
          <BaseRelationshipList bases={bases} onNodePress={handleNodePress} />
        )
      ) : null}
    </DrawerScaffold>
  );
}

const styles = StyleSheet.create({
  relationshipList: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    gap: spacing[5],
  },
});

export default function GraphScreen() {
  return (
    <ConnectionGuard>
      <GraphContent />
    </ConnectionGuard>
  );
}
