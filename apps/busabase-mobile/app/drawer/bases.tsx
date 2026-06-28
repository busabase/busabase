import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useBusabaseClient } from "~/api/use-busabase-client";
import { BaseCard } from "~/components/busabase/BaseCard";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { useNativeQuery } from "~/hooks/use-native-query";

function BasesContent() {
  const client = useBusabaseClient();
  const loadBases = useCallback(() => client?.bases.list() ?? Promise.resolve([]), [client]);
  const query = useNativeQuery(!!client, loadBases);

  return (
    <DrawerScaffold
      title="Bases"
      subtitle="Read-only base catalog"
      refreshing={query.refreshing}
      onRefresh={query.refetch}
    >
      {query.loading ? <NativeLoadingState label="Loading bases" /> : null}
      {query.error ? <NativeErrorState message={query.error} onRetry={query.refetch} /> : null}
      {!query.loading && !query.error && query.data?.length === 0 ? (
        <NativeEmptyState
          title="No bases yet"
          description="Bases created in the connected Busabase server will show here."
        />
      ) : null}
      <View style={styles.list}>
        {query.data?.map((base) => (
          <BaseCard key={base.id} base={base} />
        ))}
      </View>
    </DrawerScaffold>
  );
}

export default function BasesScreen() {
  return (
    <ConnectionGuard>
      <BasesContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  list: { marginHorizontal: 20, gap: 12 },
});
