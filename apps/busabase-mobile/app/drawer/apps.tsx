import { skipToken, useQuery } from "@tanstack/react-query";
import type { NodeVO } from "busabase-contract/types";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { NodeAvatar } from "~/domains/workspace/components/NodeAvatar";
import { getMobileNodeDestination } from "~/domains/workspace/utils/node-navigation";
import { useI18n } from "~/i18n";
import { mobile, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const ICON_SIZE = 52;
const COLUMNS = 3;

/** Nodes grouped into fixed-width rows — RN has no `grid-cols-3` shorthand. */
function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

function AppTile({ node }: { node: NodeVO }) {
  const router = useRouter();
  const tokens = useTokens();
  const destination = getMobileNodeDestination(node);
  if (destination.status === "unsupported") return <View style={styles.tile} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={node.name}
      hitSlop={mobile.hitSlop}
      style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.7 : 1 }]}
      onPress={() =>
        router.push({ pathname: destination.pathname, params: destination.params } as never)
      }
    >
      <View
        style={[styles.iconWrap, { backgroundColor: tokens.muted, borderColor: tokens.border }]}
      >
        <NodeAvatar node={node} size={ICON_SIZE * 0.55} color={tokens.foreground} />
      </View>
      <Text
        numberOfLines={2}
        style={[typography.caption, styles.label, { color: tokens.foreground }]}
      >
        {node.name}
      </Text>
    </Pressable>
  );
}

function AppsContent() {
  const { t } = useI18n();
  const buda = useBusabaseOrpc();

  const nodesQuery = useQuery(
    buda
      ? buda.orpc.nodes.list.queryOptions({ input: { types: ["airapp"] } })
      : { queryKey: ["no-connection", "apps"], queryFn: skipToken },
  );
  const nodes = nodesQuery.data ?? [];

  return (
    <DrawerScaffold
      title={t.nav.apps}
      subtitle={t.airapp.librarySubtitle}
      refreshing={nodesQuery.isRefetching}
      onRefresh={() => void nodesQuery.refetch()}
    >
      {nodesQuery.isLoading ? <NativeLoadingState label={t.nav.apps} /> : null}
      {nodesQuery.isError ? (
        <NativeErrorState
          message={t.airapp.libraryErrorBody}
          onRetry={() => void nodesQuery.refetch()}
        />
      ) : null}
      {!nodesQuery.isLoading && !nodesQuery.isError && nodes.length === 0 ? (
        <NativeEmptyState
          title={t.airapp.libraryEmptyTitle}
          description={t.airapp.libraryEmptyBody}
        />
      ) : null}
      {nodes.length > 0 ? (
        <View style={styles.grid}>
          {chunk(nodes, COLUMNS).map((row) => (
            <View key={row[0]?.id ?? "row"} style={styles.row}>
              {row.map((node) => (
                <AppTile key={node.id} node={node} />
              ))}
              {/* Pad the last row so its tiles keep the grid's column width
                  instead of stretching to fill the row. */}
              {row.length < COLUMNS
                ? Array.from({ length: COLUMNS - row.length }).map((_, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length filler, never reordered
                    <View key={index} style={styles.tile} />
                  ))
                : null}
            </View>
          ))}
        </View>
      ) : null}
    </DrawerScaffold>
  );
}

export default function AppsScreen() {
  return (
    <ConnectionGuard>
      <AppsContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  grid: { paddingHorizontal: 14, paddingVertical: 16, gap: 20 },
  row: { flexDirection: "row", gap: 12 },
  tile: { flex: 1, alignItems: "center", gap: 8 },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { textAlign: "center" },
});
