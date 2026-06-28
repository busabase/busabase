import { useRouter } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useBusabaseClient } from "~/api/use-busabase-client";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { RecordCard } from "~/components/busabase/RecordCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { useNativeQuery } from "~/hooks/use-native-query";

function RecordsContent() {
  const router = useRouter();
  const client = useBusabaseClient();
  const loadRecords = useCallback(
    () => client?.records.list({ limit: 50 }) ?? Promise.resolve([]),
    [client],
  );
  const query = useNativeQuery(!!client, loadRecords);

  return (
    <DrawerScaffold
      title="Records"
      subtitle="Read-only merged records"
      refreshing={query.refreshing}
      onRefresh={query.refetch}
    >
      {query.loading ? <NativeLoadingState label="Loading records" /> : null}
      {query.error ? <NativeErrorState message={query.error} onRetry={query.refetch} /> : null}
      {!query.loading && !query.error && query.data?.length === 0 ? (
        <NativeEmptyState
          title="No records yet"
          description="Approved and merged Busabase records will appear here."
        />
      ) : null}
      <View style={styles.list}>
        {query.data?.map((record) => (
          <RecordCard
            key={record.id}
            record={record}
            onPress={() => router.push({ pathname: "/records/[id]", params: { id: record.id } })}
          />
        ))}
      </View>
    </DrawerScaffold>
  );
}

export default function RecordsScreen() {
  return (
    <ConnectionGuard>
      <RecordsContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  list: { marginHorizontal: 20, gap: 12 },
});
