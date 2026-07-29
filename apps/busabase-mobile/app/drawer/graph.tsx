import { skipToken, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { BaseGraph } from "~/components/busabase/BaseGraph";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { getBaseGraphGrid } from "~/lib/base-graph-layout";
import { mobile, spacing } from "~/theme/tokens";

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
  const screenHeight = Math.max(
    300,
    height - (mobile.headerHeight ?? 52) - spacing[8] - spacing[4],
  );

  // The graph reflows to readable mobile columns and grows vertically. The
  // screen already owns vertical scrolling, so every node remains discoverable
  // without a second, hidden horizontal navigation axis.
  const { graphWidth, graphHeight } = useMemo(() => {
    const grid = getBaseGraphGrid(bases.length, width);
    return {
      graphWidth: width,
      graphHeight: Math.max(screenHeight, grid.minHeight),
    };
  }, [bases.length, width, screenHeight]);

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
        <BaseGraph
          bases={bases}
          width={graphWidth}
          height={graphHeight}
          onNodePress={handleNodePress}
        />
      ) : null}
    </DrawerScaffold>
  );
}

export default function GraphScreen() {
  return (
    <ConnectionGuard>
      <GraphContent />
    </ConnectionGuard>
  );
}
